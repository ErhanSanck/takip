// Firebase web yapılandırması (istemci tarafı; gizli anahtar değildir).
// Güvenlik, Firebase Realtime Database kuralları ve Authentication ile sağlanır (bkz. database.rules.json).
export const firebaseConfig = {
  apiKey: "AIzaSyBkCma7jbfyqzzSNdYKsLLT1WbZbMrIpxs",
  authDomain: "enesogrenci-91325.firebaseapp.com",
  databaseURL: "https://enesogrenci-91325-default-rtdb.firebaseio.com",
  projectId: "enesogrenci-91325",
  storageBucket: "enesogrenci-91325.firebasestorage.app",
  messagingSenderId: "364088274010",
  appId: "1:364088274010:web:98dc1daac0d094246cbc63",
  measurementId: "G-VSCX9PWJSM",
};

// Aynı Firebase projesindeki diğer veriler (örn. foto galeri) ile karışmaması için ayrı kök yol.
export const DB_ROOT = "sinavTakip";
