// src/App.js
import React, { useEffect, useState, useRef } from "react";
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

// ---- Firebase Config (keep as-is / replace if needed) ----
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

// ---- Admin Emails ----
const adminEmails = [
  "shawn@tjspecialty.com",
  "jodi@tjspecialty.com",
  "kevin@tjspecialty.com",
];

// ---- QR Code Expected Payload ----
const REQUIRED_QR_VALUE = "BLA_CHECKIN_V1"; // Make sure QR encodes this EXACT string.
const SCAN_REGION_ID = "qr-reader";

export default function App() {
  // Auth / user state
  const [user, setUser] = useState(null);
  const [adminMode, setAdminMode] = useState(false);

  // Auth form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [signup, setSignup] = useState(false);

  // User data
  const [points, setPoints] = useState(0);
  const [coupons, setCoupons] = useState([]);
  const [lastCheckIn, setLastCheckIn] = useState(null);

  // Collections
  const [allUsers, setAllUsers] = useState([]);
  const [leaderboard, setLeaderboard] = useState([]); // sorted array of leaders tied for #1
  const [topUser, setTopUser] = useState(null); // single primary leader (first in tie list)

  // QR Scanner modal & status
  const [showScanner, setShowScanner] = useState(false);
  const [scannerStatus, setScannerStatus] = useState("");
  const html5QrcodeRef = useRef(null);
  const scannerRunningRef = useRef(false);

  // Import html5-qrcode lazily (to avoid SSR / build issues)
  const Html5Qrcode = window.Html5Qrcode ? window.Html5Qrcode : null;

  // ------------------ Auth Listener ------------------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
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
        } else {
          // If user doc missing (rare), create baseline
          await setDoc(docRef, {
            email: currentUser.email,
            name: currentUser.displayName || "",
            points: 0,
            coupons: [],
            lastCheckIn: null,
          });
        }

        const isAdmin = adminEmails.includes(currentUser.email);
        setAdminMode(isAdmin);
        fetchAllUsers(isAdmin);
      } else {
        setUser(null);
        setAdminMode(false);
        setPoints(0);
        setCoupons([]);
        setLastCheckIn(null);
        setAllUsers([]);
        setLeaderboard([]);
        setTopUser(null);
      }
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------ Fetch all users (for admin & leaderboard) ------------------
  const fetchAllUsers = async (force = false) => {
    // We always fetch to keep leaderboard updated (even for non-admin so they see leaders)
    try {
      const q = query(collection(db, "users"));
      const snap = await getDocs(q);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (force || adminMode) setAllUsers(list);

      // Determine leader(s)
      const sorted = [...list].sort((a, b) => (b.points || 0) - (a.points || 0));
      if (sorted.length > 0) {
        const maxPts = sorted[0].points || 0;
        const ties = sorted.filter((u) => (u.points || 0) === maxPts);
        setLeaderboard(ties);
        setTopUser(ties[0]);
      } else {
        setLeaderboard([]);
        setTopUser(null);
      }
    } catch (e) {
      console.error("Fetch users error:", e);
    }
  };

  // Poll leaderboard periodically (optional – ensures non-admin sees updates)
  useEffect(() => {
    if (!user) return;
    fetchAllUsers(false);
    const interval = setInterval(() => fetchAllUsers(false), 30000); // 30s refresh
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ------------------ Utility: Weekly Lock Logic ------------------
  const isLockedOut = () => {
    if (!lastCheckIn) return false;
    const now = new Date();
    return now - lastCheckIn < 7 * 24 * 60 * 60 * 1000;
  };

  const nextEligibleDate = () => {
    if (!lastCheckIn) return null;
    const next = new Date(lastCheckIn.getTime() + 7 * 24 * 60 * 60 * 1000);
    return next;
  };

  const nextEligibleText = () => {
    const dt = nextEligibleDate();
    if (!dt) return "";
    return dt.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ------------------ Check-In (shared) ------------------
  const performCheckIn = async (uid) => {
    const now = new Date();
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    let data = {};
    if (snap.exists()) data = snap.data();

    const currentPoints = data.points || 0;
    const currentCoupons = data.coupons || [];
    const newPoints = currentPoints + 1;
    const newCoupons = [...currentCoupons];
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

    // If this is the currently logged-in user, update local state
    if (uid === user.uid) {
      setPoints(newPoints);
      setCoupons(newCoupons);
      setLastCheckIn(now);
    }
    // Refresh leaderboard / admin view
    fetchAllUsers(adminMode);
  };

  // ------------------ Manual Admin Check-In Button Handler ------------------
  const handleAdminCheckIn = async () => {
    if (!user) return;
    await performCheckIn(user.uid);
  };

  // ------------------ Coupon Redemption ------------------
  const handleRedeem = async (uid, couponId) => {
    const userRef = doc(db, "users", uid);
    const snap = await getDoc(userRef);
    if (!snap.exists()) return;
    const data = snap.data();
    const updated = (data.coupons || []).map((c) =>
      c.id === couponId ? { ...c, redeemed: true } : c
    );
    await updateDoc(userRef, { coupons: updated });
    if (uid === user.uid) setCoupons(updated);
    fetchAllUsers(adminMode);
  };

  // ------------------ Auth Actions ------------------
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
      const res = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await setDoc(doc(db, "users", res.user.uid), {
        email: email.trim(),
        name: name.trim(),
        points: 0,
        coupons: [],
        lastCheckIn: null,
      });
      setEmail("");
      setPassword("");
    } catch (err) {
      console.error(err);
      alert("Signup failed.");
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  // ------------------ QR Scanner Lifecycle ------------------
  const handleOpenScanner = () => {
    if (!user) return;
    setScannerStatus("Initializing...");
    setShowScanner(true);
  };

  const handleCloseScanner = () => {
    setShowScanner(false);
  };

  const onScanError = (err) => {
    // Throttle the noisy errors
    // console.debug("Scan error:", err);
  };

  const onScanSuccess = async (decodedText) => {
    // Prevent duplicate handling
    if (!scannerRunningRef.current) return;

    if (!user) {
      setScannerStatus("Not logged in.");
      return;
    }

    // Admin path: we allow always
    if (adminMode) {
      setScannerStatus("Recording admin check-in...");
      scannerRunningRef.current = false;
      await performCheckIn(user.uid);
      setScannerStatus("Admin check-in ✅");
      setTimeout(() => {
        setShowScanner(false);
        stopScanner();
      }, 1000);
      return;
    }

    // Enforce weekly AFTER a scan occurs
    if (isLockedOut()) {
      setScannerStatus(
        "Already checked-in this week. Eligible after: " + nextEligibleText()
      );
      setTimeout(() => {
        setShowScanner(false);
        stopScanner();
      }, 1800);
      return;
    }

    if (decodedText !== REQUIRED_QR_VALUE) {
      setScannerStatus("Invalid QR code.");
      setTimeout(() => setScannerStatus("Scanning..."), 1200);
      return;
    }

    // Valid code & eligible
    setScannerStatus("Saving check-in...");
    scannerRunningRef.current = false;
    await performCheckIn(user.uid);
    setScannerStatus("Check-in successful! 🎉");
    setTimeout(() => {
      setShowScanner(false);
      stopScanner();
    }, 1200);
  };

  async function startScanner() {
    if (scannerRunningRef.current) return;
    const VideoLib = window.Html5Qrcode;
    if (!VideoLib) {
      setScannerStatus("QR library not loaded.");
      return;
    }

    try {
      // Ensure container exists
      const el = document.getElementById(SCAN_REGION_ID);
      if (!el) {
        requestAnimationFrame(startScanner);
        return;
      }
      el.innerHTML = ""; // Clear any stale nodes

      if (!html5QrcodeRef.current) {
        html5QrcodeRef.current = new VideoLib(SCAN_REGION_ID, false);
      }

      scannerRunningRef.current = true;
      setScannerStatus("Initializing camera...");

      try {
        await html5QrcodeRef.current.start(
          { facingMode: { exact: "environment" } },
            { fps: 10, qrbox: 250 },
            onScanSuccess,
            onScanError
        );
      } catch (envErr) {
        // Fallback
        await html5QrcodeRef.current.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          onScanSuccess,
          onScanError
        );
      }

      setScannerStatus("Scanning...");
    } catch (err) {
      console.error("Start scanner error:", err);
      setScannerStatus("Camera error. Check permissions & retry.");
      scannerRunningRef.current = false;
    }
  }

  async function stopScanner() {
    if (!html5QrcodeRef.current) return;
    if (scannerRunningRef.current) {
      try {
        await html5QrcodeRef.current.stop();
      } catch (e) {
        // ignore
      }
    }
    scannerRunningRef.current = false;
  }

  useEffect(() => {
    if (showScanner && user) {
      const t = setTimeout(() => startScanner(), 30);
      return () => clearTimeout(t);
    } else {
      stopScanner();
    }
    return () => {
      stopScanner();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScanner, user]);

  // ------------------ Derived Values ------------------
  const locked = isLockedOut();
  const activeCoupons = coupons.filter((c) => !c.redeemed);
  const totalCoupons = coupons.length;

  // Build leader banner text
  const leaderBanner = (() => {
    if (!leaderboard.length) return "";
    const maxPts = leaderboard[0].points || 0;
    if (leaderboard.length === 1) {
      const u = leaderboard[0];
      return `${u.name || u.email} is leading with ${maxPts} check-ins!`;
    }
    const names = leaderboard
      .map((u) => u.name || u.email)
      .slice(0, 3)
      .join(", ");
    const more = leaderboard.length > 3 ? ` +${leaderboard.length - 3} more` : "";
    return `Tie at ${maxPts}: ${names}${more}`;
  })();

  // ------------------ Render ------------------
  return (
    <div className="app-shell">
      <header className="header">
        <h1 className="app-title">BLA Loyalty Rewards</h1>
      </header>

      {!user && (
        <div className="card auth-card">
          <h2 className="auth-header">{signup ? "Sign Up" : "Log In"}</h2>
          <input
            className="text-input"
            placeholder="Email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="text-input"
            placeholder="Password"
            type="password"
            autoComplete={signup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {signup && (
            <input
              className="text-input"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <button
            className="primary-btn"
            onClick={signup ? handleSignup : handleLogin}
          >
            {signup ? "Create Account" : "Log In"}
          </button>
          <p className="switch-auth" onClick={() => setSignup(!signup)}>
            {signup ? "Have an account? Log in" : "New user? Sign up"}
          </p>
        </div>
      )}

      {user && (
        <div className="content">
          <div className="user-bar">
            <p className="logged-in">
              Logged in as: <strong>{name || user.email}</strong>
            </p>
            <button className="logout-btn" onClick={handleLogout}>
              Log Out
            </button>
          </div>

            {leaderBanner && topUser && topUser.id !== user.uid && (
            <div className="leader-banner">
              <span role="img" aria-label="trophy">
                🏆
              </span>{" "}
              {leaderBanner}
            </div>
          )}

          {/* User Status Panel */}
          <div className="card status-card">
            <h2 className="section-title">Your Status</h2>
            <p className="stat-line">
              Check-ins: <strong>{points}</strong>
            </p>
            <p className="stat-line">
              Coupons:{" "}
              <strong>
                {activeCoupons.length} active / {totalCoupons} total
              </strong>
            </p>

            <button
              className={`checkin-btn ${locked ? "locked" : ""}`}
              onClick={handleOpenScanner}
            >
              {adminMode
                ? "Admin Self Check-In"
                : locked
                ? "Scan QR (Locked This Week)"
                : "Scan QR to Check-In"}
            </button>

            {/* List own coupons */}
            <div className="coupon-list">
              {coupons.map((c, i) => (
                <div
                  key={c.id}
                  className={`coupon-row ${c.redeemed ? "redeemed" : "active"}`}
                >
                  <span className="coupon-emoji">🎟️</span>
                  <span>
                    Coupon #{i + 1} —{" "}
                    {c.redeemed ? "🔴 Redeemed" : "🟢 Available"}
                  </span>
                </div>
              ))}
              {coupons.length === 0 && (
                <p className="faint">Earn a coupon every 5 check-ins.</p>
              )}
            </div>
          </div>

          {/* Admin Dashboard */}
          {adminMode && (
            <div className="card admin-card">
              <h2 className="section-title">Admin Dashboard</h2>
              {/* Admin self check-in (explicit) */}
              <div className="admin-self">
                <button className="secondary-btn" onClick={handleAdminCheckIn}>
                  Admin Manual Check-In
                </button>
              </div>
              <div className="admin-users">
                {allUsers
                  .sort((a, b) => (b.points || 0) - (a.points || 0))
                  .map((u) => {
                    const uActive = (u.coupons || []).filter((c) => !c.redeemed);
                    return (
                      <div key={u.id} className="admin-user-row">
                        <div className="admin-user-head">
                          <strong>{u.name || u.email}</strong> —{" "}
                          {u.points || 0} check-ins
                        </div>
                        <div className="admin-user-sub">
                          Coupons: {uActive.length} active /{" "}
                          {(u.coupons || []).length} total
                        </div>
                        <div className="admin-actions">
                          <button
                            className="mini-btn"
                            onClick={() => performCheckIn(u.id)}
                          >
                            Admin Check-In
                          </button>
                        </div>
                        <div className="admin-coupons">
                          {(u.coupons || []).map((c, i) => (
                            <div
                              key={c.id}
                              className={`mini-coupon ${
                                c.redeemed ? "redeemed" : "active"
                              }`}
                            >
                              🎟️ #{i + 1} —{" "}
                              {c.redeemed ? "🔴 Redeemed" : "🟢 Available"}
                              {!c.redeemed && (
                                <button
                                  className="redeem-btn"
                                  onClick={() => handleRedeem(u.id, c.id)}
                                >
                                  Redeem
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                {allUsers.length === 0 && (
                  <p className="faint">No users found.</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* QR Scanner Modal */}
      {showScanner && (
        <div className="qr-modal">
          <div className="qr-dialog">
            <h2 className="qr-title">Scan Venue QR</h2>
            <p className="qr-sub">
              Point your camera at the venue’s QR code to register this week’s
              check-in.
            </p>
            <div className="qr-box-wrapper">
              <div id={SCAN_REGION_ID} className="qr-box" />
              <div className="scan-status">{scannerStatus}</div>
            </div>
            <div className="qr-actions">
              <button className="cancel-btn" onClick={handleCloseScanner}>
                Cancel
              </button>
            </div>
            {locked && !adminMode && (
              <p className="lock-note">
                Already checked-in. Eligible again after: {nextEligibleText()}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
