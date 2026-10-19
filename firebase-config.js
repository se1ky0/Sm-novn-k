/* Směnovník – připojení k Firebase pro sdílení směn v týmu.
 * firebaseConfig z Firebase konzole (Nastavení projektu → Vaše aplikace → Web).
 * Tyto údaje nejsou tajné, data chrání pravidla ve firestore.rules. */
window.SMENOVNIK_FIREBASE = {
  apiKey: "AIzaSyC2fmQFBPItE1B6QrMgVlEaEEZlCgPqgsY",
  authDomain: "smenovnik-eb4e1.firebaseapp.com",
  projectId: "smenovnik-eb4e1",
  storageBucket: "smenovnik-eb4e1.firebasestorage.app",
  messagingSenderId: "400572728741",
  appId: "1:400572728741:web:c892a1b07e04167f3cd44c"
};

/* Server pro notifikace na zavřený telefon (push/worker.js na Cloudflare) a jeho veřejný klíč VAPID. */
window.SMENOVNIK_PUSH = {
  url: "https://smenovnik-push.smenovnik.workers.dev",
  vapid: "BBzPlOwpemSPY0gOHxB7KyYG1E30X3oe4ZAGacHyPQpx_EIKT42B394kfeu63skfK8GfnLwZLVBhZ0e6L3ZnOzA"
};
