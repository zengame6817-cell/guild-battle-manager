import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { collection, doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDIgEpviVVzCprokdbnwPaCtxIP-Et5kZM",
  authDomain: "guild-battle-manager.firebaseapp.com",
  projectId: "guild-battle-manager",
  storageBucket: "guild-battle-manager.firebasestorage.app",
  messagingSenderId: "594959264497",
  appId: "1:594959264497:web:24116b57a1b3d193925750",
  measurementId: "G-8GYCJMX629"
};

let unsubscribe = null;
let activeMode = "";

function reportError(error) {
  window.dispatchEvent(new CustomEvent("gbm-firebase-error", {
    detail: { message: error?.message || String(error) }
  }));
}

try {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  window.GBM_FIREBASE_ATTENDANCE = {
    subscribe(mode) {
      const nextMode = String(mode || "normal");
      if (unsubscribe && activeMode === nextMode) return;
      if (unsubscribe) unsubscribe();
      activeMode = nextMode;
      unsubscribe = onSnapshot(collection(db, "attendance"), snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type === "removed") return;
          const data = change.doc.data();
          if (data.mode !== activeMode || !Number.isInteger(Number(data.row))) return;
          window.dispatchEvent(new CustomEvent("gbm-firebase-attendance", {
            detail: { mode: data.mode, row: Number(data.row), checked: Boolean(data.checked) }
          }));
        });
      }, reportError);
    },

    async setAttendance(mode, row, checked) {
      const safeMode = String(mode || "normal").replace(/[^a-zA-Z0-9_-]/g, "_");
      const safeRow = Number(row);
      if (!Number.isInteger(safeRow) || safeRow < 1) throw new Error("点呼の行番号が不正です");
      await setDoc(doc(db, "attendance", `${safeMode}_${safeRow}`), {
        mode: String(mode || "normal"), row: safeRow, checked: Boolean(checked), updatedAt: serverTimestamp()
      }, { merge: true });
    }
  };

  window.dispatchEvent(new CustomEvent("gbm-firebase-ready"));
} catch (error) {
  reportError(error);
}
