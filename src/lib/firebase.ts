import { getApp, getApps, initializeApp } from "firebase/app";
import { connectFunctionsEmulator, getFunctions } from "firebase/functions";

const firebaseConfig = {
  projectId: "labflow-ocr-pangalganek-2026",
  appId: "1:468081478502:web:e6be4797c7f5f8002596a7",
  storageBucket: "labflow-ocr-pangalganek-2026.firebasestorage.app",
  apiKey: "AIzaSyDPGZ_FCP-sMC8X1VnMw6IYJzubBCO98_0",
  authDomain: "labflow-ocr-pangalganek-2026.firebaseapp.com",
  messagingSenderId: "468081478502",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const functions = getFunctions(app, "europe-central2");

if (
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true" &&
  !(globalThis as typeof globalThis & { __labflowEmulator?: boolean }).__labflowEmulator
) {
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  (globalThis as typeof globalThis & { __labflowEmulator?: boolean }).__labflowEmulator = true;
}
