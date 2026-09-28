// api/send-status-push.js
const admin = require('firebase-admin');

if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      }),
      databaseURL: process.env.FIREBASE_DATABASE_URL
    });
  } catch (initErr) {
    console.error("Firebase Admin Init Error:", initErr.message);
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { orderId, newStatus, reason } = req.body || {};
  if (!orderId || !newStatus) {
    return res.status(400).json({ error: 'Missing orderId or newStatus' });
  }

  try {
    const db = admin.database();

    // 1. Order details se customerUid nikalein
    const orderSnap = await db.ref(`orders/${orderId}`).once('value');
    const order = orderSnap.val();
    if (!order || !order.customerUid) {
      return res.status(404).json({ error: 'Order or Customer UID not found' });
    }

    // 2. Customer ka FCM Token nikalein
    const custTokenSnap = await db.ref(`deviceTokens/customers/${order.customerUid}/fcmToken`).once('value');
    let custToken = custTokenSnap.val();

    if (!custToken || typeof custToken !== 'string') {
      const directSnap = await db.ref(`deviceTokens/customers/${order.customerUid}`).once('value');
      const directVal = directSnap.val();
      if (typeof directVal === 'string') custToken = directVal;
      else if (directVal && directVal.fcmToken) custToken = directVal.fcmToken;
    }

    if (!custToken || typeof custToken !== 'string' || custToken.trim().length < 10) {
      console.log(`[StatusPush] Customer Token NOT FOUND for user: ${order.customerUid}`);
      return res.status(200).json({ success: false, message: 'Customer device token not registered' });
    }

    // 3. Status ke hisaab se Title aur Message set karein (Like Swiggy/Zomato)
    const orderRef = `#${String(orderId).slice(-6)}`;
    let title = "Order Update";
    let body = `Your order ${orderRef} status is now: ${newStatus}`;

    switch (newStatus) {
      case 'ACCEPTED':
        title = "🎉 Order Confirmed!";
        body = `Order ${orderRef}: Kitchen ne aapka order accept kar liya hai!`;
        break;
      case 'PREPARING':
        title = "👨‍🍳 Cooking in Progress!";
        body = `Order ${orderRef}: Chef fresh dishes tayyar kar rahe hain.`;
        break;
      case 'READY_FOR_PICKUP':
        title = "📦 Food Packed & Ready!";
        body = `Order ${orderRef}: Khana pack ho gaya hai, delivery partner pickup kar raha hai.`;
        break;
      case 'PICKED_UP':
      case 'OUT_FOR_DELIVERY':
        title = "🛵 Out for Delivery!";
        body = `Order ${orderRef}: Rider khana lekar aapki taraf nikal chuka hai!`;
        break;
      case 'DELIVERED':
        title = "✅ Order Delivered!";
        body = `Order ${orderRef}: Khana deliver ho gaya hai. Enjoy your meal!`;
        break;
      case 'CANCELLED':
        title = "❌ Order Cancelled";
        body = `Order ${orderRef}: ${reason || 'Aapka order cancel kar diya gaya hai.'}`;
        break;
    }

    // 4. Customer ke phone par High-Priority Lock Screen Push bhejein
    await admin.messaging().send({
      token: custToken.trim(),
      notification: {
        title: title,
        body: body
      },
      android: {
        priority: "high",
        ttl: 60 * 1000,
        notification: {
          channelId: "fw_customer_orders_v4",
          sound: "default",
          defaultSound: true,
          defaultVibrateTimings: true,
          priority: "max",
          visibility: "public"
        }
      },
      data: {
        orderId: String(orderId),
        status: String(newStatus),
        type: "CUSTOMER_STATUS_UPDATE"
      }
    });

    console.log(`✅ [StatusPush] Customer notified for Order ${orderRef} (${newStatus})`);
    return res.status(200).json({ success: true, message: 'Customer notified successfully' });

  } catch (error) {
    console.error("Status Push Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
