// firebaseAdmin.js (Root folder mein)
const admin = require('firebase-admin');

if (!admin.apps.length) {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (privateKey) {
    // 1. Agar Vercel mein quotes ("") lag gaye hon toh unhe remove karein
    privateKey = privateKey.replace(/^"|"$/g, '');
    // 2. Literal \n ko actual newlines me convert karein
    privateKey = privateKey.replace(/\\n/g, '\n');
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || "foodworldfixed";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (!clientEmail || !privateKey) {
    console.error("❌ CRITICAL: FIREBASE_CLIENT_EMAIL ya FIREBASE_PRIVATE_KEY Vercel Environment Variables me missing hai!");
  } else {
    try {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: privateKey
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL || "https://foodworldfixed-default-rtdb.firebaseio.com"
      });
      console.log("✅ Firebase Admin successfully initialized!");
    } catch (err) {
      console.error("❌ Firebase Admin initialization error:", err.message);
    }
  }
}

module.exports = admin;
