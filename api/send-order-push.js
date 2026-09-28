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
  // CORS Headers allow karein
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { orderId, restaurantId, totalAmount } = req.body || {};
  if (!orderId || !restaurantId) {
    console.warn("Push Trigger Rejected: Missing orderId or restaurantId", req.body);
    return res.status(400).json({ error: 'Missing orderId or restaurantId' });
  }

  console.log(`\n==================================================`);
  console.log(`[ORDER PUSH TRIGGERED] Order #${String(orderId).slice(-6)} | Kitchen: ${restaurantId} | Amount: ₹${totalAmount}`);

  try {
    const db = admin.database();

    // =========================================================
    // 🍳 1. KITCHEN TOKEN DHOONDHEIN (WITH SAFE FALLBACK)
    // =========================================================
    let restToken = null;
    const restTokenSnap = await db.ref(`deviceTokens/restaurants/${restaurantId}/fcmToken`).once('value');
    restToken = restTokenSnap.val();

    // Fallback: Agar token direct node par save ho
    if (!restToken || typeof restToken !== 'string') {
      const directSnap = await db.ref(`deviceTokens/restaurants/${restaurantId}`).once('value');
      const directVal = directSnap.val();
      if (typeof directVal === 'string') restToken = directVal;
      else if (directVal && typeof directVal.fcmToken === 'string') restToken = directVal.fcmToken;
    }

    if (restToken && typeof restToken === 'string' && restToken.trim().length > 10) {
      console.log(`✅ Kitchen Token Found: ${restToken.slice(0, 15)}...`);
    } else {
      console.warn(`❌ Kitchen Token NOT FOUND for restaurant: ${restaurantId}`);
      restToken = null;
    }

    // =========================================================
    // 🛵 2. ACTIVE RIDERS KE TOKENS DHOONDHEIN
    // =========================================================
    const ridersSnap = await db.ref('deviceTokens/riders').once('value');
    const ridersData = ridersSnap.val() || {};
    const riderTokens = [];

    Object.keys(ridersData).forEach(uid => {
      const rider = ridersData[uid];
      if (!rider) return;

      // 🌟 Safe Check: Boolean true ho ya string "true", dono chalenge
      const isOnline = (rider.online === true || rider.online === 'true' || rider.online === 1);
      const token = rider.fcmToken || (typeof rider === 'string' ? rider : null);

      if (isOnline && token && typeof token === 'string' && token.trim().length > 10) {
        riderTokens.push(token.trim());
      }
    });

    const uniqueRiderTokens = [...new Set(riderTokens)]; // Duplicates remove karein
    console.log(`🛵 Online Rider Tokens Found: ${uniqueRiderTokens.length}`);

    // =========================================================
    // 🚀 3. HIGH-PRIORITY FCM PUSH DISPATCH
    // =========================================================
    const dispatchPromises = [];
    let kitchenDispatched = false;
    let ridersDispatchedCount = 0;

    // Kitchen Notification Send
    if (restToken) {
      const kitchenMessage = {
        token: restToken,
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
          sound: "kitchen_siren",
          amount: String(totalAmount || "0")
        }
      };

      dispatchPromises.push(
        admin.messaging().send(kitchenMessage)
          .then(resId => {
            console.log("✅ Kitchen FCM Dispatched Successfully:", resId);
            kitchenDispatched = true;
          })
          .catch(err => {
            console.error("❌ Kitchen FCM Send Failed:", err.message);
            // Agar token expire ho gaya ho toh database se clean karein
            if (err.code === 'messaging/registration-token-not-registered') {
              db.ref(`deviceTokens/restaurants/${restaurantId}`).remove().catch(() => {});
            }
          })
      );
    }

    // Riders Notification Multicast Send
    if (uniqueRiderTokens.length > 0) {
      const riderMessage = {
        tokens: uniqueRiderTokens,
        notification: {
          title: "⚡ NAYA DELIVERY TASK!",
          body: `Order #${String(orderId).slice(-6)} available nearby. Earn: ₹${totalAmount}`
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
          sound: "kitchen_siren",
          amount: String(totalAmount || "0")
        }
      };

      dispatchPromises.push(
        admin.messaging().sendEachForMulticast(riderMessage)
          .then(batchRes => {
            console.log(`✅ Riders Multicast Sent: ${batchRes.successCount} Success, ${batchRes.failureCount} Failed`);
            ridersDispatchedCount = batchRes.successCount;
          })
          .catch(err => {
            console.error("❌ Riders Multicast Failed:", err.message);
          })
      );
    }

    // Dono messages complete hone ka wait karein
    await Promise.allSettled(dispatchPromises);
    console.log(`==================================================\n`);

    return res.status(200).json({
      success: true,
      kitchenPushed: kitchenDispatched,
      ridersPushedCount: ridersDispatchedCount,
      summary: `Kitchen: ${kitchenDispatched ? 'Sent' : 'Skipped/Failed'}, Riders: ${ridersDispatchedCount}`
    });

  } catch (error) {
    console.error("Fatal Push Error:", error);
    return res.status(500).json({ error: error.message });
  }
};
