// api/send-order-push.js
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
    console.log("Firebase Admin Initialized Successfully");
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

  const { orderId, restaurantId, totalAmount } = req.body || {};
  if (!orderId || !restaurantId) {
    return res.status(400).json({ error: 'Missing orderId or restaurantId' });
  }

  console.log(`\n==================================================`);
  console.log(`[ORDER PUSH] Order #${String(orderId).slice(-6)} | Kitchen: ${restaurantId} | Amount: ₹${totalAmount}`);

  try {
    const db = admin.database();
    const dispatchPromises = [];

    // =========================================================
    // 🍳 1. KITCHEN TOKEN DHOONDHEIN AUR PUSH BHEJEIN
    // =========================================================
    const restTokenSnap = await db.ref(`deviceTokens/restaurants/${restaurantId}/fcmToken`).once('value');
    let restToken = restTokenSnap.val();

    if (!restToken || typeof restToken !== 'string') {
      const directSnap = await db.ref(`deviceTokens/restaurants/${restaurantId}`).once('value');
      const directVal = directSnap.val();
      if (typeof directVal === 'string') restToken = directVal;
      else if (directVal && directVal.fcmToken) restToken = directVal.fcmToken;
    }

    if (restToken && typeof restToken === 'string' && restToken.trim().length > 10) {
      dispatchPromises.push(
        admin.messaging().send({
          token: restToken.trim(),
          notification: {
            title: "🚨 NAYA KITCHEN ORDER AAYA!",
            body: `Order #${String(orderId).slice(-6)} received. Amount: ₹${totalAmount}`
          },
          android: {
            priority: "high",
            ttl: 60 * 1000,
            notification: {
              channelId: "fw_kitchen_siren_v4",
              sound: "kitchen_siren",
              defaultSound: true,
              defaultVibrateTimings: true,
              priority: "max",
              visibility: "public"
            }
          },
          data: {
            orderId: String(orderId),
            type: "NEW_ORDER",
            amount: String(totalAmount || "0")
          }
        }).then(() => console.log("✅ Kitchen FCM Sent"))
          .catch(err => console.error("❌ Kitchen FCM Failed:", err.message))
      );
    }

    // =========================================================
    // 🛵 2. ACTIVE ONLINE RIDERS KO MULTICAST PUSH BHEJEIN
    // =========================================================
    const ridersSnap = await db.ref('deviceTokens/riders').once('value');
    const ridersData = ridersSnap.val() || {};
    const riderTokens = [];

    Object.keys(ridersData).forEach(uid => {
      const rider = ridersData[uid];
      if (!rider) return;
      const isOnline = (rider.online === true || rider.online === 'true' || rider.online === 1);
      const token = rider.fcmToken || (typeof rider === 'string' ? rider : null);
      if (isOnline && token && typeof token === 'string' && token.trim().length > 10) {
        riderTokens.push(token.trim());
      }
    });

    const uniqueRiderTokens = [...new Set(riderTokens)];
    if (uniqueRiderTokens.length > 0) {
      dispatchPromises.push(
        admin.messaging().sendEachForMulticast({
          tokens: uniqueRiderTokens,
          notification: {
            title: "⚡ NAYA DELIVERY TASK!",
            body: `Order #${String(orderId).slice(-6)} nearby available. Amount: ₹${totalAmount}`
          },
          android: {
            priority: "high",
            ttl: 60 * 1000,
            notification: {
              channelId: "fw_rider_siren_v4",
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
            amount: String(totalAmount || "0")
          }
        }).then(res => console.log(`✅ Riders Multicast Sent: ${res.successCount} Success`))
          .catch(err => console.error("❌ Riders Multicast Failed:", err.message))
      );
    }

    // =========================================================
    // 🛡️ 3. 🌟 SUPER ADMIN KO EMERGENCY PUSH BHEJEIN
    // =========================================================
    const adminSnap = await db.ref('deviceTokens/admins').once('value');
    const adminData = adminSnap.val() || {};
    const adminTokens = [];

    Object.keys(adminData).forEach(uid => {
      const token = adminData[uid]?.fcmToken || (typeof adminData[uid] === 'string' ? adminData[uid] : null);
      if (token && typeof token === 'string' && token.trim().length > 10) {
        adminTokens.push(token.trim());
      }
    });

    const uniqueAdminTokens = [...new Set(adminTokens)];
    if (uniqueAdminTokens.length > 0) {
      dispatchPromises.push(
        admin.messaging().sendEachForMulticast({
          tokens: uniqueAdminTokens,
          notification: {
            title: "🚨 ADMIN RADAR: NAYA ORDER AAYA!",
            body: `Order #${String(orderId).slice(-6)} received. Amount: ₹${totalAmount}`
          },
          android: {
            priority: "high",
            ttl: 60 * 1000,
            notification: {
              channelId: "fw_admin_orders_v3",
              sound: "default",
              defaultSound: true,
              defaultVibrateTimings: true,
              priority: "max",
              visibility: "public"
            }
          },
          data: {
            orderId: String(orderId),
            type: "ADMIN_RADAR_ALERT",
            amount: String(totalAmount || "0")
          }
        }).then(res => console.log(`✅ Admin Multicast Sent: ${res.successCount} Success`))
          .catch(err => console.error("❌ Admin Multicast Failed:", err.message))
      );
    }

    await Promise.allSettled(dispatchPromises);
    console.log(`==================================================\n`);

    return res.status(200).json({ success: true, message: 'All target pushes processed' });

  } catch (error) {
    console.error("Push Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
