// firebase.js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyC4A4fr0B-cJTFhzYE6hQBq-Qw2t07XKlw",
  authDomain: "bla-dealer-app.firebaseapp.com",
  projectId: "bla-dealer-app",
  storageBucket: "bla-dealer-app.firebasestorage.app",
  messagingSenderId: "999902556520",
  appId: "1:999902556520:web:f7c215c1036cb2af5566dd",
  measurementId: "G-GQG741YCLF"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

export { app, auth, db };

