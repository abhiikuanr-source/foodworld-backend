// api/send-order-push.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { orderId, restaurantId, totalAmount } = req.body;
  if (!orderId || !restaurantId) {
    return res.status(400).json({ error: 'Missing orderId or restaurantId' });
  }

  try {
    const db = admin.database();

    // 1. Restaurant owner ka token fetch karein (Server-side)
    const restTokenSnap = await db.ref(`deviceTokens/restaurants/${restaurantId}/fcmToken`).once('value');
    const restToken = restTokenSnap.val();

    // 2. Active online riders ke tokens fetch karein (Server-side)
    const ridersSnap = await db.ref('deviceTokens/riders').once('value');
    const ridersData = ridersSnap.val() || {};
    const riderTokens = [];

    Object.keys(ridersData).forEach(uid => {
      if (ridersData[uid]?.online === true && ridersData[uid]?.fcmToken) {
        riderTokens.push(ridersData[uid].fcmToken);
      }
    });

    const messages = [];

    // Kitchen ko notification
    if (restToken) {
      messages.push(admin.messaging().send({
        token: restToken,
        notification: {
          title: "🔴 New Order Received!",
          body: `Order #${orderId.slice(-6)} received. Amount: ₹${totalAmount}`
        },
        data: { orderId }
      }));
    }

    // Riders ko notification
    if (riderTokens.length > 0) {
      messages.push(admin.messaging().sendEachForMulticast({
        tokens: riderTokens,
        notification: {
          title: "⚡ New Delivery Task Nearby!",
          body: `New order available to accept. Earn ₹${totalAmount}`
        },
        data: { orderId }
      }));
    }

    await Promise.all(messages);
    return res.status(200).json({ success: true, message: 'Push dispatched securely from server' });

  } catch (error) {
    console.error("Push Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
