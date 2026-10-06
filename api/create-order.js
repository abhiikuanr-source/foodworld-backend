const Razorpay = require('razorpay');

module.exports = async (req, res) => {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Only POST method is allowed' });
  }

  try {
    // 2. Safe Body Parsing
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const parsedAmount = Number(body.amount);

    if (!parsedAmount || isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: 'Valid amount is required (minimum ₹1)' });
    }

    // 3. Environment Variables Check
    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      console.error('❌ Razorpay keys missing in Vercel environment variables!');
      return res.status(500).json({ error: 'Payment gateway configuration missing on server' });
    }

    const instance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });

    const options = {
      amount: Math.round(parsedAmount * 100), // Rupees to Paise
      currency: "INR",
      receipt: String(body.receipt || ("rcpt_" + Date.now())).slice(0, 40)
    };

    const order = await instance.orders.create(options);
    return res.status(200).json(order);

  } catch (error) {
    console.error('Razorpay Order Create Error:', error);
    return res.status(500).json({ error: error.message || 'Failed to create Razorpay order' });
  }
};
