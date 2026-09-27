import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: "geezaflick-default-rtdb.firebaseapp.com",
  databaseURL: "https://geezaflick-default-rtdb.firebaseio.com/",
  projectId: "geezaflick-default-rtdb",
  storageBucket: "geezaflick-default-rtdb.appspot.com"
};

const statusDot = document.getElementById("status-dot");
const statusText = document.getElementById("status-text");
const loginForm = document.getElementById("login-form");
const loginButton = document.getElementById("login-button");

if (!firebaseConfig.apiKey) {
  statusText.textContent = "Missing API key";
  loginButton.disabled = true;
  throw new Error("Set VITE_FIREBASE_API_KEY in your .env file.");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const ledToggle = document.getElementById("led-toggle");
const ledLabel = document.getElementById("led-label");
const servoToggle = document.getElementById("servo-toggle");
const servoLabel = document.getElementById("servo-label");
const ledCard = document.getElementById("led-card");
const servoCard = document.getElementById("servo-card");
const geyserDuration = document.getElementById("geyser-duration");
const geyserTimerLabel = document.getElementById("geyser-timer-label");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  statusText.textContent = "Signing in...";

  try {
    await signInWithEmailAndPassword(
      auth,
      document.getElementById("email").value.trim(),
      document.getElementById("password").value
    );
    statusText.textContent = "Online";
    statusDot.style.background = "var(--accent)";
    loginForm.hidden = true;
    ledCard.hidden = false;
    servoCard.hidden = false;
    ledToggle.disabled = false;
    servoToggle.disabled = false;
    listenToFirebase();
  } catch (error) {
    statusText.textContent = "Auth Error";
    statusDot.style.background = "#ef4444";
    console.error("Firebase Auth Error:", error);
    loginButton.disabled = false;
  }
});

function listenToFirebase() {
  const ledRef = ref(db, "/led/state");
  const servoRef = ref(db, "/servo/state");
  const timerStorageKey = "flicka.geyser.autoOffAt";
  let timerDeadline = null;
  let timerInterval = null;
  let nextAutoOffAttempt = 0;
  let pendingGeyserState = null;

  onValue(ledRef, (snapshot) => {
    const isOn = snapshot.val() === 1;
    ledToggle.checked = isOn;
    ledLabel.textContent = `State: ${isOn ? "ON" : "OFF"}`;
  });

  onValue(servoRef, (snapshot) => {
    const isOn = snapshot.val() === 1;
    servoToggle.checked = isOn;
    servoLabel.textContent = `State: ${isOn ? "ON" : "OFF"}`;
    geyserDuration.disabled = isOn;

    if (pendingGeyserState !== null) {
      return;
    }

    if (isOn) {
      startGeyserTimer(true);
    } else {
      stopGeyserTimer();
    }
  });

  ledToggle.addEventListener("change", (event) => {
    set(ledRef, event.target.checked ? 1 : 0);
  });

  servoToggle.addEventListener("change", (event) => {
    const isOn = event.target.checked;
    const previousDeadline = localStorage.getItem(timerStorageKey);

    if (isOn) {
      startGeyserTimer(false);
    } else {
      pauseGeyserTimer();
    }

    pendingGeyserState = isOn ? 1 : 0;
    set(servoRef, pendingGeyserState)
      .then(() => {
        pendingGeyserState = null;
        if (isOn) {
          startGeyserTimer(true);
        } else {
          stopGeyserTimer();
        }
      })
      .catch((error) => {
        console.error("Firebase Geyser Update Error:", error);
        pendingGeyserState = null;
        if (isOn) {
          stopGeyserTimer();
        } else {
          if (previousDeadline) {
            localStorage.setItem(timerStorageKey, previousDeadline);
          }
          startGeyserTimer(true);
        }
      });
  });

  function startGeyserTimer(restoreDeadline) {
    clearInterval(timerInterval);
    const savedDeadline = Number(localStorage.getItem(timerStorageKey));
    timerDeadline = restoreDeadline && savedDeadline > 0
      ? savedDeadline
      : Date.now() + Number(geyserDuration.value) * 60_000;
    localStorage.setItem(timerStorageKey, String(timerDeadline));
    timerInterval = setInterval(updateGeyserCountdown, 1000);
    updateGeyserCountdown();
  }

  function pauseGeyserTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerDeadline = null;
    geyserTimerLabel.textContent = "Auto-off starts when switched on";
  }

  function stopGeyserTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerDeadline = null;
    localStorage.removeItem(timerStorageKey);
    geyserTimerLabel.textContent = "Auto-off starts when switched on";
  }

  function requestGeyserAutoOff() {
    const deadline = timerDeadline;
    pendingGeyserState = 0;
    pauseGeyserTimer();
    geyserTimerLabel.textContent = "Auto-off: switching off...";

    set(servoRef, 0)
      .then(() => {
        pendingGeyserState = null;
        stopGeyserTimer();
      })
      .catch((error) => {
        console.error("Firebase Geyser Auto-off Error:", error);
        pendingGeyserState = null;
        localStorage.setItem(timerStorageKey, String(deadline));
        startGeyserTimer(true);
        nextAutoOffAttempt = Date.now() + 10_000;
        geyserTimerLabel.textContent = "Auto-off failed; retrying shortly";
      });
  }

  function updateGeyserCountdown() {
    const remainingSeconds = Math.ceil((timerDeadline - Date.now()) / 1000);
    if (remainingSeconds <= 0) {
      geyserTimerLabel.textContent = "Auto-off: switching off...";
      if (Date.now() >= nextAutoOffAttempt) {
        requestGeyserAutoOff();
      }
      return;
    }

    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    const countdown = [hours, minutes, seconds]
      .map((part) => String(part).padStart(2, "0"))
      .join(":");
    geyserTimerLabel.textContent = `Auto-off in ${countdown}`;
  }
}