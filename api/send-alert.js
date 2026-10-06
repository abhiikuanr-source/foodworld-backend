const admin = require('../firebaseAdmin'); // Root ke firebaseAdmin.js se connect karein

module.exports = async (req, res) => {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const { targetToken, title, body, channelId, sound, data } = req.body || {};

  if (!targetToken) {
    return res.status(400).json({ success: false, error: 'Target token is required' });
  }

  try {
    // 2. Data payload ke sabhi values strictly String hone chahiye (FCM rule)
    const stringData = {};
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(key => {
        stringData[key] = String(data[key]);
      });
    }
    stringData.title = String(title || "New Alert");
    stringData.body = String(body || "");

    // 3. Complete FCM Message with High Priority + Data Payload
    const message = {
      token: targetToken,
      notification: {
        title: title || "New Alert",
        body: body || ""
      },
      data: stringData, // Screen off me background alarm trigger karne ke liye zaroori
      android: {
        priority: 'high', // Screen jagane ke liye
        notification: {
          channelId: channelId || 'fw_kitchen_siren_v4', // App channel match
          sound: sound || 'default',
          priority: 'max',
          visibility: 'public',
          defaultVibrateTimings: true,
          defaultLightSettings: true
        }
      }
    };

    const response = await admin.messaging().send(message);
    return res.status(200).json({ success: true, messageId: response });
  } catch (error) {
    console.error('FCM Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};
