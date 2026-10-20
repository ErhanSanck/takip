// Veri katmanı: Firebase (Authentication + Realtime Database) veya Firebase'siz deneme modu (?demo).
// Uygulama yalnızca bu dosyadaki arayüzü kullanır:
//   backend.onAuth(cb) · signIn(email, pw) · signOut() · subscribe(cb) · applyUpdates(obj)
import { firebaseConfig, DB_ROOT } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

export async function createBackend({ demo = false } = {}) {
  return demo ? createDemoBackend() : createFirebaseBackend();
}

async function createFirebaseBackend() {
  const [{ initializeApp }, A, D] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-database.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = D.getDatabase(app);
  const root = D.ref(db, DB_ROOT);
  return {
    mode: "firebase",
    onAuth: (cb) => A.onAuthStateChanged(auth, (u) => cb(u ? { email: u.email } : null)),
    signIn: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => A.signOut(auth),
    subscribe(cb, onError) {
      return D.onValue(root, (snap) => cb(snap.val() || {}), (err) => onError && onError(err));
    },
    // Çoklu yol güncellemesi: tek istekte, ya hep ya hiç. null değer silme demektir.
    applyUpdates: (updates) => D.update(root, updates),
  };
}

// ---- Deneme modu: veriler yalnızca bu tarayıcıda (localStorage) tutulur ----
function createDemoBackend() {
  const KEY = "sinavTakipDemo";
  let state = {};
  try { state = JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { state = {}; }
  const subs = new Set();
  const emit = () => subs.forEach((cb) => cb(structuredClone(state)));
  return {
    mode: "demo",
    onAuth: (cb) => setTimeout(() => cb({ email: "demo" }), 0),
    signIn: async () => {},
    signOut: async () => {},
    subscribe(cb) {
      subs.add(cb);
      setTimeout(() => cb(structuredClone(state)), 0);
      return () => subs.delete(cb);
    },
    async applyUpdates(updates) {
      for (const [path, value] of Object.entries(updates)) {
        const keys = path.split("/");
        let o = state;
        for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
        const last = keys[keys.length - 1];
        if (value === null) delete o[last]; else o[last] = structuredClone(value);
      }
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* depolama dolu olabilir */ }
      emit();
    },
  };
}
