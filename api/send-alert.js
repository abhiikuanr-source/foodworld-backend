const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    })
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { targetToken, title, body, channelId, sound } = req.body || {};

  if (!targetToken) {
    return res.status(400).json({ error: 'Target token is required' });
  }

  try {
    const message = {
      token: targetToken,
      notification: {
        title: title || "New Alert",
        body: body || ""
      },
      android: {
        priority: 'high', // स्क्रीन जगाने के लिए सबसे जरूरी
        notification: {
          channelId: channelId || 'default',
          sound: sound || 'default',
          priority: 'max',
          visibility: 'public'
        }
      }
    };

    const response = await admin.messaging().send(message);
    res.status(200).json({ success: true, messageId: response });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};
