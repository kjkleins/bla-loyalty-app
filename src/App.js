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

/* ---------------- Firebase Config (unchanged except storageBucket fix if needed) ----------- */
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

/* ---------------- Admins ---------------- */
const adminEmails = [
  "shawn@tjspecialty.com",
  "jodi@tjspecialty.com",
  "kevin@tjspecialty.com",
];

/* ---------------- QR Secret (single venue code) ----------- */
const QR_SECRET = "BLA_CHECKIN_2025";

/* ================= MAIN APP ================= */
export default function App() {
  const [user, setUser] = useState(null);
  const [adminMode, setAdminMode] = useState(false);

  // Auth form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [name, setName] = useState("");

  // User data
  const [points, setPoints] = useState(0);
  const [coupons, setCoupons] = useState([]);
  const [lastCheckIn, setLastCheckIn] = useState(null);

  // Global lists
  const [allUsers, setAllUsers] = useState([]);
  const [leaders, setLeaders] = useState([]); // list of top users (ties)
  const [loadingUsers, setLoadingUsers] = useState(false);

  // QR scanning
  const [showScanner, setShowScanner] = useState(false);
  const [scanning, setScanning] = useState(false);

  // UI feedback
  const [statusMsg, setStatusMsg] = useState("");

  /* --------- Runtime logo path CSS variable (GitHub Pages aware) ---------- */
  useEffect(() => {
    const base =
      process.env.PUBLIC_URL && process.env.PUBLIC_URL !== "."
        ? process.env.PUBLIC_URL
        : "";
    const normalized = base.replace(/\/+$/, "");
    const logoPath = `${normalized}/logo.png`;
    document.documentElement.style.setProperty(
      "--logo-path",
      `url("${logoPath}")`
    );
  }, []);

  /* --------- Auth listener ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (current) => {
      if (current) {
        setUser(current);
        const ref = doc(db, "users", current.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
            setPoints(data.points || 0);
            setCoupons(data.coupons || []);
            setLastCheckIn(data.lastCheckIn?.toDate() || null);
            setName(data.name || "");
        } else {
          // Ensure a user doc exists
          await setDoc(ref, {
            email: current.email,
            name: "",
            points: 0,
            coupons: [],
            lastCheckIn: null,
            createdAt: Timestamp.now(),
          });
        }
        if (adminEmails.includes(current.email)) {
          setAdminMode(true);
          fetchAllUsers();
        } else {
          setAdminMode(false);
          fetchAllUsers(); // still fetch to compute leaders for standard users
        }
      } else {
        setUser(null);
        setAdminMode(false);
        setPoints(0);
        setCoupons([]);
        setLastCheckIn(null);
        setAllUsers([]);
        setLeaders([]);
      }
    });
    return () => unsub();
  }, []);

  /* --------- Fetch all users (for leaders + admin) ---------- */
  const fetchAllUsers = async () => {
    setLoadingUsers(true);
    try {
      const q = query(collection(db, "users"));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setAllUsers(list);

      // Determine leaders (highest points, handle ties)
      if (list.length) {
        const max = Math.max(...list.map((u) => u.points || 0));
        const topList = list
          .filter((u) => (u.points || 0) === max)
          .sort((a, b) =>
            (a.name || a.email).localeCompare(b.name || b.email)
          );
        setLeaders(topList);
      } else {
        setLeaders([]);
      }
    } finally {
      setLoadingUsers(false);
    }
  };

  /* --------- Weekly check-in guard ---------- */
  const canCheckIn = () => {
    if (!lastCheckIn) return true;
    const now = Date.now();
    const diff = now - lastCheckIn.getTime();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    return diff >= WEEK;
  };

  /* --------- Handle user check-in (requires scanning unless admin) ---------- */
  const performCheckIn = async (uid, currentData) => {
    const now = new Date();
    const ref = doc(db, "users", uid);
    const currentPoints = currentData?.points ?? points;
    const currentCoupons = currentData?.coupons ?? coupons;

    const newPoints = currentPoints + 1;
    const newCoupons = [...currentCoupons];
    if (newPoints % 5 === 0) {
      newCoupons.push({ id: Date.now(), redeemed: false });
    }

    await setDoc(
      ref,
      {
        points: newPoints,
        coupons: newCoupons,
        lastCheckIn: Timestamp.fromDate(now),
      },
      { merge: true }
    );

    if (uid === user.uid) {
      setPoints(newPoints);
      setCoupons(newCoupons);
      setLastCheckIn(now);
    }
    fetchAllUsers();
    setStatusMsg("Check-in recorded!");
    setTimeout(() => setStatusMsg(""), 2500);
  };

  const handleCheckIn = async () => {
    if (!user) return;
    if (!canCheckIn()) {
      alert("You can only check in once per week.");
      return;
    }
    // Non-admin must scan QR
    if (!adminMode) {
      setShowScanner(true);
      setScanning(true);
      return;
    }
    await performCheckIn(user.uid);
  };

  /* --------- QR scanning logic (native) ---------- */
  useEffect(() => {
    let video = null;
    let stream = null;
    let rafId = null;

    async function startScanner() {
      try {
        video = document.createElement("video");
        video.setAttribute("playsinline", "true");
        video.style.display = "none";
        document.body.appendChild(video);

        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        video.srcObject = stream;
        await video.play();

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");

        const scan = () => {
          if (!scanning) return;
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
              const code = decodeSimpleQR(canvas);
              if (code) {
                if (code.data === QR_SECRET) {
                  stopScanner();
                  performCheckIn(user.uid);
                } else {
                  alert("Invalid QR code.");
                  stopScanner();
                }
                return;
              }
            }
          rafId = requestAnimationFrame(scan);
        };
        scan();
      } catch (err) {
        console.error(err);
        alert("Unable to start camera.");
        stopScanner();
      }
    }

    function stopScanner() {
      setScanning(false);
      setShowScanner(false);
      if (rafId) cancelAnimationFrame(rafId);
      if (video) {
        video.pause();
        video.remove();
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
    }

    // Basic brightness-based pseudo decode (placeholder)
    function decodeSimpleQR(canvas) {
      const ctx = canvas.getContext("2d");
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4 * 50) {
        sum += data[i]; // red channel sample
      }
      const avg = sum / (data.length / (4 * 50));
      if (avg < 40) {
        return { data: QR_SECRET }; // simulated success if mostly dark
      }
      return null;
    }

    if (scanning && showScanner) {
      startScanner();
    }

    return () => {
      // cleanup
      if (rafId) cancelAnimationFrame(rafId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (video) video.remove();
    };
  }, [scanning, showScanner, user]);

  /* --------- Redeem coupon ---------- */
  const handleRedeem = async (uid, couponId) => {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const data = snap.data();
    const updated = (data.coupons || []).map((c) =>
      c.id === couponId ? { ...c, redeemed: true } : c
    );
    await updateDoc(ref, { coupons: updated });
    if (uid === user.uid) setCoupons(updated);
    fetchAllUsers();
  };

  /* --------- Login & Signup ---------- */
  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setEmail("");
      setPassword("");
    } catch (err) {
      console.error(err);
      alert("Login failed.");
    }
  };

  const handleSignup = async () => {
    try {
      const res = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      await setDoc(doc(db, "users", res.user.uid), {
        email: email.trim(),
        name: name.trim(),
        points: 0,
        coupons: [],
        lastCheckIn: null,
        createdAt: Timestamp.now(),
      });
      setEmail("");
      setPassword("");
    } catch (err) {
      console.error(err);
      alert("Signup failed.");
    }
  };

  /* --------- Helpers ---------- */
  const userDisplayName = (u) => u.name || u.email;

  const userCouponsActive = coupons.filter((c) => !c.redeemed).length;
  const userCouponsTotal = coupons.length;

  /* --------- Leader banner (for ALL users) ---------- */
  const showLeaderBanner =
    leaders.length > 0 &&
    user &&
    !leaders.some((l) => l.id === user.uid); // show only if you're not among leaders

  return (
    <div className="app-container">
      <div className="content-card">
        <h1 className="app-title">BLA Loyalty Rewards</h1>

        {!user && (
            <div className="auth-panel">
              <h2>{signup ? "Create Account" : "Log In"}</h2>
              <input
                className="text-input"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
              />
              <input
                className="text-input"
                placeholder="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={signup ? "new-password" : "current-password"}
              />
              {signup && (
                <input
                  className="text-input"
                  placeholder="Display Name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
              <button
                className="primary-btn"
                onClick={signup ? handleSignup : handleLogin}
              >
                {signup ? "Sign Up" : "Log In"}
              </button>
              <p className="toggle-link" onClick={() => setSignup(!signup)}>
                {signup ? "Have an account? Log in" : "New user? Sign up"}
              </p>
            </div>
        )}

        {user && (
          <>
            <p className="logged-in">
              Logged in as: <strong>{userDisplayName({ name, email: user.email })}</strong>
            </p>
            <button
              className="logout-btn"
              onClick={() => {
                signOut(auth);
              }}
            >
              Log Out
            </button>

            {showLeaderBanner && (
              <div className="leader-banner">
                🏆{" "}
                {leaders
                  .map((l) => userDisplayName(l))
                  .join(", ")}{" "}
                {leaders.length === 1 ? "is" : "are"} leading with{" "}
                {leaders[0].points} check-ins!
              </div>
            )}

            {statusMsg && <div className="status-msg">{statusMsg}</div>}

            {/* User / Admin Self Panel */}
            <div className="user-panel">
              <h2 className="panel-heading">Your Status</h2>
              <p className="stat-line">
                Check-ins: <strong>{points}</strong>
              </p>
              <p className="stat-line">
                Coupons:{" "}
                <strong>
                  {userCouponsActive} active / {userCouponsTotal} total
                </strong>
              </p>
              <button
                disabled={!canCheckIn() && !adminMode}
                className="checkin-btn"
                onClick={handleCheckIn}
              >
                {adminMode ? "Admin Self Check-In" : "Scan QR to Check-In"}
              </button>

              <ul className="coupon-list">
                {coupons.map((c, i) => (
                  <li key={c.id} className={c.redeemed ? "coupon redeemed" : "coupon"}>
                    🎟 Coupon #{i + 1} —{" "}
                    {c.redeemed ? "🔴 Redeemed" : "🟢 Available"}
                  </li>
                ))}
              </ul>
            </div>

            {/* Admin Dashboard */}
            {adminMode && (
              <div className="admin-panel">
                <h2 className="panel-heading">Admin Dashboard</h2>
                {loadingUsers && <p>Loading users…</p>}
                {!loadingUsers &&
                  allUsers
                    .sort((a, b) => (b.points || 0) - (a.points || 0))
                    .map((u) => {
                      const active = (u.coupons || []).filter((c) => !c.redeemed)
                        .length;
                      return (
                        <div key={u.id} className="admin-user-card">
                          <div className="admin-user-header">
                            <strong>{userDisplayName(u)}</strong> —{" "}
                            {u.points || 0} check-ins
                          </div>
                          <div className="admin-user-sub">
                            Coupons: {active} active / {(u.coupons || []).length} total
                          </div>

                          <div className="admin-actions">
                            <button
                              className="small-btn"
                              onClick={async () => {
                                // weekly restriction not enforced for admin performing remote check-in
                                await performCheckIn(u.id, u);
                              }}
                            >
                              Admin Check-In
                            </button>
                          </div>

                          <ul className="coupon-list condensed">
                            {(u.coupons || []).map((c, i) => (
                              <li
                                key={c.id}
                                className={c.redeemed ? "coupon redeemed" : "coupon"}
                              >
                                🎟 Re-Buy #{i + 1} —{" "}
                                {c.redeemed ? "🔴 Redeemed" : "🟢 Available"}
                                {!c.redeemed && (
                                  <button
                                    className="redeem-btn"
                                    onClick={() => handleRedeem(u.id, c.id)}
                                  >
                                    Redeem
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
              </div>
            )}
          </>
        )}
      </div>

      {/* QR Scanner Modal */}
      {showScanner && (
        <div className="scanner-overlay">
          <div className="scanner-modal">
            <h3>Scan Venue QR</h3>
            <p className="scanner-hint">
              Point your camera at the venue’s QR code to register this week’s
              check-in.
            </p>
            <div className="scanner-area">
              <div className="scanner-placeholder">
                {scanning ? "Scanning..." : "Stopped"}
              </div>
            </div>
            <button
              className="cancel-btn"
              onClick={() => {
                setShowScanner(false);
                setScanning(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
