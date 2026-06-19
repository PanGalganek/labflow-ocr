import { getApp, getApps, initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  projectId: "labflow-ocr-pangalganek-2026",
  appId: "1:468081478502:web:e6be4797c7f5f8002596a7",
  storageBucket: "labflow-ocr-pangalganek-2026.firebasestorage.app",
  apiKey: "AIzaSyDPGZ_FCP-sMC8X1VnMw6IYJzubBCO98_0",
  authDomain: "labflow-ocr-pangalganek-2026.firebaseapp.com",
  messagingSenderId: "468081478502",
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider("6LeceigtAAAAAL2wlnmxpp9eta62TC5G5dqfzc3i"),
  isTokenAutoRefreshEnabled: true,
});
export const auth = getAuth(app);
