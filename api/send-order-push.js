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

    // 1. Restaurant owner ka token fetch karein
    const restTokenSnap = await db.ref(`deviceTokens/restaurants/${restaurantId}/fcmToken`).once('value');
    const restToken = restTokenSnap.val();

    // 2. Active online riders ke tokens fetch karein
    const ridersSnap = await db.ref('deviceTokens/riders').once('value');
    const ridersData = ridersSnap.val() || {};
    const riderTokens = [];

    Object.keys(ridersData).forEach(uid => {
      if (ridersData[uid]?.online === true && ridersData[uid]?.fcmToken) {
        riderTokens.push(ridersData[uid].fcmToken);
      }
    });

    const messages = [];

    // =========================================================
    // 🍳 1. KITCHEN KO HIGH-PRIORITY PUSH (DOZE MODE BYPASS)
    // =========================================================
    if (restToken) {
      messages.push(admin.messaging().send({
        token: restToken,
        notification: {
          title: "🚨 NAYA KITCHEN ORDER AAYA!",
          body: `Order #${orderId.slice(-6)} received. Amount: ₹${totalAmount}`
        },
        // 🌟 Android Deep Sleep / 15-30 Min Doze Mode Bypass Payload:
        android: {
          priority: "high",
          ttl: 60 * 1000, // 60 seconds
          notification: {
            channelId: "fw_kitchen_siren_v4", // Kitchen app me banaya gaya channel
            sound: "kitchen_siren",
            defaultSound: true,
            defaultVibrateTimings: true,
            priority: "max",
            visibility: "public"
          }
        },
        // 🌟 Background WebView/JS ko jagane ke liye Data Payload:
        data: {
          orderId: String(orderId),
          type: "NEW_ORDER",
          sound: "kitchen_siren",
          amount: String(totalAmount || "0")
        }
      }));
    }

    // =========================================================
    // 🛵 2. RIDERS KO HIGH-PRIORITY BROADCAST PUSH
    // =========================================================
    if (riderTokens.length > 0) {
      messages.push(admin.messaging().sendEachForMulticast({
        tokens: riderTokens,
        notification: {
          title: "⚡ NAYA DELIVERY TASK!",
          body: `Order #${orderId.slice(-6)} available nearby. Earn: ₹${totalAmount}`
        },
        // 🌟 Android High Priority Payload:
        android: {
          priority: "high",
          ttl: 60 * 1000,
          notification: {
            channelId: "fw_rider_siren_v4", // Rider app me banaya gaya channel
            sound: "default",
            defaultSound: true,
            defaultVibrateTimings: true,
            priority: "max",
            visibility: "public"
          }
        },
        data: {
          orderId: String(orderId),
          type: "NEW_TASK",
          sound: "kitchen_siren",
          amount: String(totalAmount || "0")
        }
      }));
    }

    await Promise.all(messages);
    return res.status(200).json({ success: true, message: 'High-priority push dispatched successfully' });

  } catch (error) {
    console.error("Push Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
