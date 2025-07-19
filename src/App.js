import React, { useEffect, useState, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
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
import { Html5Qrcode } from "html5-qrcode";
import "./index.css";

/* ------------ Firebase Config ------------ */
const firebaseConfig = {
  apiKey: "AIzaSyC4A4fr0B-cJTFhzYE6hQBq-Qw2t07XKlw",
  authDomain: "bla-dealer-app.firebaseapp.com",
  projectId: "bla-dealer-app",
  storageBucket: "bla-dealer-app.appspot.com",
  messagingSenderId: "999902556520",
  appId: "1:999902556520:web:f7c215c1036cb2af5566dd",
  measurementId: "G-GQG741YCLF",
};

initializeApp(firebaseConfig);
const auth = getAuth();
const db = getFirestore();

/* ------------ Constants ------------ */
const ADMIN_EMAILS = [
  "shawn@tjspecialty.com",
  "jodi@tjspecialty.com",
  "kevin@tjspecialty.com",
];
const QR_TOKEN = "bla-poker-checkin";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export default function LoyaltyApp() {
  /* Auth / Role */
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);

  /* Auth Form */
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signUpMode, setSignUpMode] = useState(false);
  const [name, setName] = useState("");

  /* User Data */
  const [points, setPoints] = useState(0);
  const [coupons, setCoupons] = useState([]);
  const [lastCheckIn, setLastCheckIn] = useState(null);

  /* Users / Leaders */
  const [allUsers, setAllUsers] = useState([]);
  const [leaders, setLeaders] = useState([]);

  /* Scanner State */
  const [showScanner, setShowScanner] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);

  /* Refs */
  const scannerRef = useRef(null);
  const scannerRunningRef = useRef(false);

  /* ---------- Auth Listener ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (current) => {
      if (current) {
        setUser(current);
        const admin = ADMIN_EMAILS.includes(current.email);
        setIsAdmin(admin);
        await loadUserData(current.uid);
        await loadAllUsers();
      } else {
        resetState();
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => () => stopScanner(true), []);

  /* ---------- Loaders ---------- */
  const resetState = () => {
    setUser(null);
    setIsAdmin(false);
    setEmail("");
    setPassword("");
    setName("");
    setPoints(0);
    setCoupons([]);
    setLastCheckIn(null);
    setAllUsers([]);
    setLeaders([]);
    setShowScanner(false);
    setCameraError("");
    stopScanner(true);
  };

  const loadUserData = async (uid) => {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      setName(d.name || "");
      setPoints(d.points || 0);
      setCoupons(d.coupons || []);
      setLastCheckIn(d.lastCheckIn?.toDate() || null);
    }
  };

  const loadAllUsers = async () => {
    const q = query(collection(db, "users"));
    const snap = await getDocs(q);
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setAllUsers(list);
    if (list.length) {
      const maxPoints = Math.max(...list.map((u) => u.points || 0));
      setLeaders(
        maxPoints > 0 ? list.filter((u) => (u.points || 0) === maxPoints) : []
      );
    } else {
      setLeaders([]);
    }
  };

  /* ---------- Auth Actions ---------- */
  const handleLogin = async () => {
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch {
      alert("Login failed.");
    }
  };

  const handleSignUp = async () => {
    try {
      const cred = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      await setDoc(doc(db, "users", cred.user.uid), {
        email: email.trim(),
        name: name.trim(),
        points: 0,
        coupons: [],
        lastCheckIn: null,
      });
    } catch {
      alert("Sign up failed.");
    }
  };

  const logout = () => {
    stopScanner(true);
    signOut(auth);
  };

  /* ---------- Check-In Logic ---------- */
  const performCheckIn = async (uid) => {
    const ref = doc(db, "users", uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return false;

    const data = snap.data();
    const now = new Date();
    const last = data.lastCheckIn?.toDate();
    if (last && now - last < ONE_WEEK_MS) {
      alert("You can only check in once per week.");
      return false;
    }

    const newPoints = (data.points || 0) + 1;
    const newCoupons = [...(data.coupons || [])];
    if (newPoints % 5 === 0) {
      newCoupons.push({ id: Date.now(), redeemed: false });
    }

    await setDoc(
      ref,
      {
        points: newPoints,
        coupons: newCoupons,
        lastCheckIn: Timestamp.fromDate(now),
        email: data.email || user.email,
        name: data.name || name,
      },
      { merge: true }
    );

    if (uid === user.uid) {
      setPoints(newPoints);
      setCoupons(newCoupons);
      setLastCheckIn(now);
    }

    await loadAllUsers();
    return true;
  };

  const handleAdminSelfCheckIn = async () => {
    if (!user) return;
    await performCheckIn(user.uid);
  };

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
    await loadAllUsers();
  };

  /* ---------- Scanner Logic (Modal) ---------- */
  const startScanner = async () => {
    setCameraError("");
    if (
      window.location.protocol !== "https:" &&
      window.location.hostname !== "localhost"
    ) {
      setCameraError(
        "Camera may be blocked on HTTP. Use HTTPS or a tunnel (ngrok/localtunnel)."
      );
    }
    if (scannerRunningRef.current) return;

    setShowScanner(true);

    setTimeout(async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setCameraError("Camera API not supported in this browser.");
          return;
        }

        if (!scannerRef.current) {
          scannerRef.current = new Html5Qrcode("qr-reader");
        }

        const cameras = await Html5Qrcode.getCameras();
        if (cameras && cameras.length) {
          setAvailableCameras(cameras);
          const env =
            cameras.find((c) => /back|environment/i.test(c.label)) || cameras[0];
          setSelectedCameraId(env.id);
          await startWithCameraId(env.id);
        } else {
          await startWithFacingMode();
        }
      } catch (err) {
        console.error("Scanner init failed:", err);
        setCameraError("Unable to start camera. Check permissions / HTTPS.");
        stopScanner(true);
      }
    }, 80);
  };

  const startWithCameraId = async (id) => {
    if (!scannerRef.current) return;
    await scannerRef.current.start(
      { deviceId: { exact: id } },
      { fps: 10, qrbox: 240 },
      onDecodeSuccess,
      onFrameError
    );
    scannerRunningRef.current = true;
  };

  const startWithFacingMode = async () => {
    if (!scannerRef.current) return;
    await scannerRef.current.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 240 },
      onDecodeSuccess,
      onFrameError
    );
    scannerRunningRef.current = true;
  };

  const onDecodeSuccess = (decodedText) => {
    if (decodedText === QR_TOKEN) {
      stopScanner(true);
      performCheckIn(user.uid).then((ok) => {
        if (ok) alert("✅ Check-in successful!");
      });
    } else {
      alert("🚫 Invalid QR Code");
      stopScanner(true);
    }
  };
  const onFrameError = () => {};

  const stopScanner = (silent = false) => {
    if (showScanner) setShowScanner(false);
    if (scannerRef.current && scannerRunningRef.current) {
      scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current?.clear();
          scannerRunningRef.current = false;
        })
        .catch((e) => {
          console.warn("Stop ignored:", e?.message);
          scannerRunningRef.current = false;
        });
    }
    if (!silent) {
      // could add toast
    }
  };

  const handleCameraSwitch = async (e) => {
    const newId = e.target.value;
    setSelectedCameraId(newId);
    if (scannerRef.current && scannerRunningRef.current) {
      await scannerRef.current
        .stop()
        .then(() => {
          scannerRef.current.clear();
          scannerRunningRef.current = false;
        })
        .catch(() => {
          scannerRunningRef.current = false;
        });
      try {
        await startWithCameraId(newId);
      } catch (err) {
        console.error("Camera switch failed:", err);
        setCameraError("Failed to switch camera.");
      }
    }
  };

  /* Close scanner on ESC */
  const escHandler = useCallback(
    (e) => {
      if (e.key === "Escape" && showScanner) stopScanner();
    },
    [showScanner]
  );
  useEffect(() => {
    window.addEventListener("keydown", escHandler);
    return () => window.removeEventListener("keydown", escHandler);
  }, [escHandler]);

  /* ---------- UI Helpers ---------- */
  const renderLeaders = () =>
    leaders.length ? (
      <div className="leader-box">
        🏆 Leader{leaders.length > 1 ? "s" : ""}:{" "}
        {leaders.map((l) => l.name || l.email).join(", ")} — {leaders[0].points} check-ins
      </div>
    ) : null;

  /* ---------- Auth Screen ---------- */
  if (!user) {
    return (
      <div className="auth-wrapper">
        <h1 className="app-title">BLA Loyalty Rewards</h1>
        <div className="auth-card">
          {signUpMode && (
            <input
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            placeholder="Email"
            value={email}
            type="email"
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            placeholder="Password"
            value={password}
            type="password"
            onChange={(e) => setPassword(e.target.value)}
          />
          <button onClick={signUpMode ? handleSignUp : handleLogin}>
            {signUpMode ? "Sign Up" : "Log In"}
          </button>
          <p
            className="switch-mode"
            onClick={() => setSignUpMode((m) => !m)}
          >
            {signUpMode ? "Have an account? Log In" : "New user? Sign up"}
          </p>
        </div>
      </div>
    );
  }

  /* ---------- Main App Screen ---------- */
  return (
    <div className={`app-shell ${showScanner ? "no-scroll" : ""}`}>
      <div className="top-bar">
        <span className="user-name">Logged in as: {name || user.email}</span>
        <button className="logout-btn" onClick={logout}>
          Log Out
        </button>
      </div>

      {renderLeaders()}

      <div className="panel">
        <h2>Your Status</h2>
        <p>Check-ins: {points}</p>
        <p>
          Coupons: {coupons.filter((c) => !c.redeemed).length} active /{" "}
          {coupons.length} total
        </p>
        {lastCheckIn && (
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Last Check-In: {lastCheckIn.toLocaleDateString()}
          </p>
        )}

        {!isAdmin && !showScanner && (
          <button className="primary" onClick={startScanner}>
            📷 Scan QR to Check-In
          </button>
        )}

        {isAdmin && (
          <button className="primary" onClick={handleAdminSelfCheckIn}>
            Admin Self Check-In
          </button>
        )}

        <ul className="coupon-list">
          {coupons.map((c, i) => (
            <li key={c.id}>
              🎟️ Coupon #{i + 1} — {c.redeemed ? "🔴 Redeemed" : "🟢 Available"}
            </li>
          ))}
        </ul>
      </div>

      {isAdmin && (
        <div className="panel admin-panel">
          <h2>Admin Dashboard</h2>
          {allUsers.map((u) => (
            <div key={u.id} className="user-row">
              <div className="user-summary">
                <strong>{u.name || u.email}</strong> — {u.points || 0} check-ins | Coupons:{" "}
                {(u.coupons || []).length}
              </div>
              <div className="admin-actions">
                <button
                  className="small-btn"
                  onClick={() => performCheckIn(u.id)}
                >
                  + Check-In
                </button>
              </div>
              <ul className="coupon-mini-list">
                {(u.coupons || []).map((c, i) => (
                  <li key={c.id}>
                    🎟️ #{i + 1} {c.redeemed ? "🔴" : "🟢"}
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
          ))}
        </div>
      )}

      {/* -------- Modal Scanner Overlay -------- */}
      {showScanner && (
        <div className="scanner-modal">
          <div className="scanner-dialog">
            <button
              className="scanner-close"
              aria-label="Close scanner"
              onClick={() => stopScanner()}
            >
              ✕
            </button>
            <h3 className="scanner-title">Scan QR Code</h3>
            <div id="qr-reader" className="qr-reader-box" />
            {availableCameras.length > 1 && (
              <div className="camera-switch">
                <label>Camera:</label>
                <select
                  value={selectedCameraId || ""}
                  onChange={handleCameraSwitch}
                >
                  {availableCameras.map((cam) => (
                    <option key={cam.id} value={cam.id}>
                      {cam.label || cam.id}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {cameraError && (
              <p className="camera-error">{cameraError}</p>
            )}
            <button
              className="secondary wide"
              onClick={() => stopScanner()}
              style={{ marginTop: 12 }}
            >
              Cancel
            </button>
            <p className="scanner-hint">
              Point your camera at the venue QR code to check in.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
