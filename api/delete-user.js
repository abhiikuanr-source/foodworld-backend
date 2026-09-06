// api/delete-user.js
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
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { uid, role } = req.body;
  if (!uid) return res.status(400).json({ error: 'Missing uid' });

  try {
    const db = admin.database();
    const updates = {};

    if (role === 'restaurant') {
      updates[`restaurants/${uid}`] = null;
      updates[`menus/${uid}`] = null;
    } else if (role === 'delivery') {
      updates[`deliveryPartners/${uid}`] = null;
      updates[`deviceTokens/riders/${uid}`] = null;
    } else if (role === 'customer') {
      updates[`customers/${uid}`] = null;
    }

    // 1. Realtime Database से पूरा डेटा हटाएं
    await db.ref().update(updates);

    // 2. Firebase Authentication से लॉगिन खाता हमेशा के लिए खत्म करें (ईमेल फ्री हो जाएगा)
    try {
      await admin.auth().deleteUser(uid);
    } catch (authErr) {
      console.log("Auth delete note:", authErr.message);
    }

    return res.status(200).json({ 
      success: true, 
      message: `User ${uid} completely deleted from Database and Authentication.` 
    });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.status(500).json({ error: err.message || 'Failed to delete user' });
  }
};
