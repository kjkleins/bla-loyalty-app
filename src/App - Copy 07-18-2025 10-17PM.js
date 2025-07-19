import React, { useEffect, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  getDocs,
  Timestamp,
} from "firebase/firestore";
import "./index.css";

const firebaseConfig = {
  apiKey: "AIzaSyC4A4fr0B-cJTFhzYE6hQBq-Qw2t07XKlw",
  authDomain: "bla-dealer-app.firebaseapp.com",
  projectId: "bla-dealer-app",
  storageBucket: "bla-dealer-app.appspot.com",
  messagingSenderId: "999902556520",
  appId: "1:999902556520:web:f7c215c1036cb2af5566dd",
  measurementId: "G-GQG741YCLF",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const adminEmails = ["shawn@tjspecialty.com", "jodi@tjspecialty.com", "kevin@tjspecialty.com"];

export default function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [signup, setSignup] = useState(false);
  const [points, setPoints] = useState(0);
  const [coupons, setCoupons] = useState([]);
  const [lastCheckIn, setLastCheckIn] = useState(null);
  const [adminMode, setAdminMode] = useState(false);
  const [allUsers, setAllUsers] = useState([]);
  const [topUser, setTopUser] = useState(null);

  useEffect(() => {
    onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        const docRef = doc(db, "users", currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setPoints(data.points || 0);
          setCoupons(data.coupons || []);
          setLastCheckIn(data.lastCheckIn?.toDate() || null);
          setName(data.name || "");
        }
if (adminEmails.includes(currentUser.email)) {
  setAdminMode(true);
}

fetchAllUsers(); // always fetch to set topUser for all users

      } else {
        setUser(null);
        setPoints(0);
        setCoupons([]);
        setAdminMode(false);
        setAllUsers([]);
        setTopUser(null);
      }
    });
  }, []);

  const fetchAllUsers = async () => {
    const q = query(collection(db, "users"));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setAllUsers(list);
    const sorted = [...list].sort((a, b) => (b.points || 0) - (a.points || 0));
    if (sorted.length > 0) {
      setTopUser(sorted[0]);
    }
  };

  const handleCheckIn = async () => {
    const now = new Date();
    if (lastCheckIn && now - lastCheckIn < 7 * 24 * 60 * 60 * 1000) {
      alert("You can only check in once per week.");
      return;
    }

    const userRef = doc(db, "users", user.uid);
    const newPoints = points + 1;
    const newCoupons = [...coupons];
    if (newPoints % 5 === 0) {
      newCoupons.push({ id: Date.now(), redeemed: false });
    }
    await setDoc(
      userRef,
      {
        email: user.email,
        name,
        points: newPoints,
        coupons: newCoupons,
        lastCheckIn: Timestamp.fromDate(now),
      },
      { merge: true }
    );
    setPoints(newPoints);
    setCoupons(newCoupons);
    setLastCheckIn(now);
    if (adminMode) fetchAllUsers();
  };

  const handleRedeem = async (uid, couponId) => {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    if (snap.exists()) {
      const data = snap.data();
      const updated = (data.coupons || []).map((c) =>
        c.id === couponId ? { ...c, redeemed: true } : c
      );
      await updateDoc(userRef, { coupons: updated });
      if (user.uid === uid) setCoupons(updated);
      if (adminMode) fetchAllUsers();
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      alert("Login failed.");
    }
  };

  const handleSignup = async () => {
    try {
      const res = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, "users", res.user.uid), {
        email,
        name,
        points: 0,
        coupons: [],
        lastCheckIn: null,
      });
    } catch {
      alert("Signup failed.");
    }
  };

  return (
    <div className="app-container">
      {!user && (
        <div className="card">
          <h2>{signup ? "Sign Up" : "Log In"}</h2>
          <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signup && (
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <button onClick={signup ? handleSignup : handleLogin}>
            {signup ? "Sign Up" : "Log In"}
          </button>
          <p className="toggle" onClick={() => setSignup(!signup)}>
            {signup ? "Have an account? Log in" : "New user? Sign up"}
          </p>
        </div>
      )}

      {user && (
        <div className="card">
          <p>Logged in as: <strong>{name || user.email}</strong></p>
          <button className="logout" onClick={() => signOut(auth)}>Log Out</button>

          {topUser && topUser.uid !== user.uid && (
            <div className="leader">
              🏆 {topUser.name || topUser.email} is leading with {topUser.points} check-ins!
            </div>
          )}

          {/* ✅ Everyone gets a check-in */}
          <div className="user-panel">
            <p>You have {points} check-ins.</p>
            <button className="checkin-button" onClick={handleCheckIn}>
              {adminMode ? "Admin Self Check-In" : "Check In"}
            </button>
            <ul>
              {coupons.map((c, i) => (
                <li key={c.id}>
                  📌 Coupon #{i + 1} — {c.redeemed ? "✅ Redeemed" : "🟢 Available"}
                </li>
              ))}
            </ul>
          </div>

          {/* ✅ Admin dashboard */}
          {adminMode && (
            <div className="admin-panel">
              <h3>Admin Dashboard</h3>
              {allUsers.map((u) => (
                <div key={u.id} className="admin-user">
                  <strong>{u.name || u.email}</strong> — {u.points || 0} check-ins
                  <p>Coupons Earned: {(u.coupons || []).length}</p>
                  <button className="checkin-button" onClick={async () => {
                    const now = new Date();
                    const userRef = doc(db, "users", u.id);
                    const newPoints = (u.points || 0) + 1;
                    const newCoupons = [...(u.coupons || [])];
                    if (newPoints % 5 === 0) {
                      newCoupons.push({ id: Date.now(), redeemed: false });
                    }
                    await setDoc(
                      userRef,
                      {
                        points: newPoints,
                        coupons: newCoupons,
                        lastCheckIn: Timestamp.fromDate(now),
                      },
                      { merge: true }
                    );
                    fetchAllUsers();
                  }}>Admin Check-In</button>

                  <ul>
                    {(u.coupons || []).map((c, i) => (
                      <li key={c.id}>
                        🎫 Re-Buy #{i + 1} — {c.redeemed ? "❌ Redeemed" : "🟢 Available"}
                        {!c.redeemed && (
                          <button
                            className="redeem-button"
                            onClick={() => handleRedeem(u.id, c.id)}
                          >
                            Redeem
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}