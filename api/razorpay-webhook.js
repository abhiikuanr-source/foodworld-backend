const crypto = require('crypto');
const admin = require('firebase-admin');

// 1. FIREBASE ADMIN SDK INITIALIZATION
if (!admin.apps.length) {
  // Vercel Environment Variables से सर्विस अकाउंट की लें
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://foodworldfixed-default-rtdb.firebaseio.com"
    });
  } else {
    // अगर सर्विस अकाउंट सेट नहीं है, तो डिफ़ॉल्ट URL से इनिशियलाइज़ करें
    admin.initializeApp({
      databaseURL: "https://foodworldfixed-default-rtdb.firebaseio.com"
    });
  }
}

const db = admin.database();

// Vercel को बताएं कि बॉडी को पार्स न करे (क्योंकि सिग्नेचर के लिए Raw Body चाहिए)
export const config = {
  api: {
    bodyParser: false,
  },
};

// Raw Body पढ़ने के लिए हेल्पर फ़ंक्शन
async function getRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    // 1. Raw Body निकालें
    const rawBodyBuffer = await getRawBody(req);
    const rawBody = rawBodyBuffer.toString('utf8');

    // 2. Razorpay Signature Verify करें
    const signature = req.headers['x-razorpay-signature'];
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("⚠️ RAZORPAY_WEBHOOK_SECRET environment variable is missing!");
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const expectedSignature = crypto
      .createHmac('sha256', webhookSecret)
      .update(rawBody)
      .digest('hex');

    if (expectedSignature !== signature) {
      console.error("❌ Invalid Webhook Signature! Possible fraud attempt.");
      return res.status(400).json({ error: 'Invalid Webhook Signature' });
    }

    // 3. पेलोड पार्स करें
    const eventData = JSON.parse(rawBody);
    const event = eventData.event;
    console.log(`🔔 Razorpay Webhook Event Received: ${event}`);

    // =======================================================
    // EVENT 1: PAYMENT SUCCESSFUL (payment.captured या order.paid)
    // =======================================================
    if (event === 'payment.captured' || event === 'order.paid') {
      const payment = eventData.payload.payment.entity;
      
      // Razorpay Order ID और Receipt (Firebase Order ID) निकालें
      const razorpayOrderId = payment.order_id;
      const paymentId = payment.id;
      
      // नोट्स या रिसिप्ट से Firebase का OrderId लें
      let firebaseOrderId = payment.notes?.firebaseOrderId || payment.description?.replace('Food Order #', '');

      // अगर नोट्स में नहीं मिला, तो Razorpay Order ID से Firebase में ऑर्डर ढूंढें
      if (!firebaseOrderId) {
        const orderSnap = await db.ref('orders')
          .orderByChild('razorpayOrderId')
          .equalTo(razorpayOrderId)
          .once('value');

        if (orderSnap.exists()) {
          firebaseOrderId = Object.keys(orderSnap.val())[0];
        }
      }

      if (firebaseOrderId) {
        console.log(`✅ Order #${firebaseOrderId} payment verified via Webhook! Payment ID: ${paymentId}`);

        // Firebase Realtime Database में ऑर्डर अपडेट करें
        const orderRef = db.ref(`orders/${firebaseOrderId}`);
        const currentOrderSnap = await orderRef.once('value');
        const currentOrder = currentOrderSnap.val();

        if (currentOrder) {
          const updates = {};
          updates[`orders/${firebaseOrderId}/paymentStatus`] = 'PAID_ONLINE';
          updates[`orders/${firebaseOrderId}/razorpayPaymentId`] = paymentId;
          updates[`orders/${firebaseOrderId}/status`] = currentOrder.status === 'CANCELLED' ? 'CANCELLED' : 'PLACED';
          updates[`orders/${firebaseOrderId}/updatedAt`] = Date.now();

          // अगर ऑर्डर अभी भी असाइन नहीं हुआ है, तो unassignedOrders में डालें
          if (!currentOrder.deliveryUid && currentOrder.status !== 'CANCELLED') {
            updates[`unassignedOrders/${firebaseOrderId}`] = {
              orderId: firebaseOrderId,
              restaurantId: currentOrder.restaurantId,
              customerAddress: currentOrder.address,
              totalAmount: currentOrder.totalAmount,
              paymentMethod: 'ONLINE',
              razorpayPaymentId: paymentId,
              createdAt: currentOrder.createdAt || Date.now()
            };
          }

          await db.ref().update(updates);
          console.log(`🚀 Firebase Order #${firebaseOrderId} successfully updated by Webhook.`);
        }
      } else {
        console.warn(`⚠️ No Firebase order found for Razorpay Order: ${razorpayOrderId}`);
      }
    }

    // =======================================================
    // EVENT 2: PAYMENT FAILED
    // =======================================================
    else if (event === 'payment.failed') {
      const payment = eventData.payload.payment.entity;
      console.warn(`❌ Payment Failed for Order: ${payment.order_id}, Reason: ${payment.error_description}`);
      // यदि चाहें तो Firebase में paymentStatus = 'FAILED' अपडेट कर सकते हैं
    }

    // Razorpay को तुरंत 200 OK रिस्पॉन्स दें (अन्यथा Razorpay बार-बार री-ट्राई करेगा)
    return res.status(200).json({ status: 'success' });

  } catch (err) {
    console.error("🚨 Webhook Processing Error:", err);
    // एरर आने पर भी 200/500 सोच-समझकर भेजें ताकि Razorpay लूप न बनाए
    return res.status(500).json({ error: err.message });
  }
}
