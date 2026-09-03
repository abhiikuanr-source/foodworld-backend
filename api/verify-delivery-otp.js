const admin = require('firebase-admin');

// Firebase Admin SDK इनिशियलाइज़ करें
if (!admin.apps.length) {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://foodworldfixed-default-rtdb.firebaseio.com"
    });
  } else {
    admin.initializeApp({
      databaseURL: "https://foodworldfixed-default-rtdb.firebaseio.com"
    });
  }
}

const db = admin.database();

export default async function handler(req, res) {
  // CORS Headers (ताकि डिलीवरी ऐप बिना रुकावट कॉल कर सके)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { orderId, enteredOtp, riderUid } = req.body;

    if (!orderId || !enteredOtp || !riderUid) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // 1. Firebase से ऑर्डर की डिटेल्स निकालें (सुरक्षित सर्वर पर)
    const orderRef = db.ref(`orders/${orderId}`);
    const orderSnap = await orderRef.once('value');
    const order = orderSnap.val();

    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // पक्का करें कि वही राइडर डिलीवर कर रहा है जिसे ऑर्डर असाइन है
    if (order.deliveryUid !== riderUid) {
      return res.status(403).json({ error: 'Unauthorized: Order assigned to another rider' });
    }

    if (order.status === 'DELIVERED') {
      return res.status(400).json({ error: 'Order is already delivered' });
    }

    // 2. सर्वर-साइड OTP मिलान (Brute-Force से सुरक्षित)
    const actualOtp = String(order.deliveryOtp || '').trim();
    if (String(enteredOtp).trim() !== actualOtp) {
      return res.status(400).json({ success: false, error: 'Invalid Code! Please check with customer.' });
    }

    // 3. OTP सही होने पर सीधे सर्वर से ऑर्डर DELIVERED करें
    const isOnline = (order.paymentMethod === 'ONLINE');
    await orderRef.update({
      status: 'DELIVERED',
      verifiedDelivery: true,
      verifiedOtp: enteredOtp,
      paymentStatus: isOnline ? 'PAID_ONLINE' : 'PAID_COD',
      deliveredAt: Date.now(),
      updatedAt: Date.now()
    });

    return res.status(200).json({
      success: true,
      message: 'Delivery verified successfully',
      paymentMethod: order.paymentMethod,
      totalAmount: order.totalAmount
    });

  } catch (err) {
    console.error("OTP Verification Error:", err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
