// api/refund-order.js
const Razorpay = require('razorpay');
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

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { orderId, reason } = req.body;
  if (!orderId) return res.status(400).json({ error: 'Missing orderId' });

  try {
    const db = admin.database();
    const orderSnap = await db.ref(`orders/${orderId}`).once('value');
    const order = orderSnap.val();

    if (!order) return res.status(404).json({ error: 'Order not found' });

    // अगर पेमेंट ऑनलाइन था और कट चुका था, तो Razorpay रिफंड ट्रिगर करें
    if (order.paymentMethod === 'ONLINE' && order.razorpayPaymentId) {
      const refund = await razorpay.payments.refund(order.razorpayPaymentId, {
        notes: { orderId: orderId, reason: reason || 'Order Cancelled' }
      });

      await db.ref(`orders/${orderId}`).update({
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED',
        refundId: refund.id,
        cancelReason: reason || 'Cancelled & Refunded',
        updatedAt: Date.now()
      });

      return res.status(200).json({ success: true, message: 'Refund initiated successfully', refundId: refund.id });
    } else {
      // अगर COD था तो सिर्फ स्टेटस कैंसल करें
      await db.ref(`orders/${orderId}`).update({
        status: 'CANCELLED',
        cancelReason: reason || 'Cancelled',
        updatedAt: Date.now()
      });
      return res.status(200).json({ success: true, message: 'Order cancelled (No refund required for COD)' });
    }
  } catch (err) {
    console.error('Refund Error:', err);
    return res.status(500).json({ error: err.message || 'Refund failed' });
  }
};
