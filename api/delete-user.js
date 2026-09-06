const admin = require('../firebaseAdmin');

module.exports = async (req, res) => {
  // 1. CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const { uid, role } = req.body || {};
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
      updates[`deviceTokens/customers/${uid}`] = null;
    }

    // 1. Delete from Realtime Database
    await db.ref().update(updates);

    // 2. Delete login account from Firebase Authentication
    try {
      await admin.auth().deleteUser(uid);
    } catch (authErr) {
      console.log("Auth delete note:", authErr.message);
    }

    return res.status(200).json({ 
      success: true, 
      message: `User ${uid} completely deleted.` 
    });
  } catch (err) {
    console.error("Delete user error:", err);
    return res.status(500).json({ error: err.message || 'Failed to delete user' });
  }
};
