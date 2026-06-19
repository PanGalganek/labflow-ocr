import {
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import { Beaker, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, Sparkles } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { auth } from "./lib/firebase";

const AUTH_MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "Nieprawidłowy e-mail lub hasło.",
  "auth/invalid-email": "Podaj prawidłowy adres e-mail.",
  "auth/operation-not-allowed": "Logowanie e-mail/hasło nie jest jeszcze włączone w Firebase.",
  "auth/too-many-requests": "Zbyt wiele prób. Odczekaj chwilę i spróbuj ponownie.",
  "auth/weak-password": "Hasło musi mieć co najmniej 6 znaków.",
};

function authErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    return AUTH_MESSAGES[code] ?? "Nie udało się zalogować. Spróbuj ponownie.";
  }
  return "Nie udało się zalogować. Spróbuj ponownie.";
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    setUser(nextUser);
    setChecking(false);
  }), []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (submitError) {
      setError(authErrorMessage(submitError));
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async () => {
    if (!email.trim()) {
      setError("Najpierw wpisz adres e-mail.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setNotice("Wysłaliśmy wiadomość do ustawienia nowego hasła.");
    } catch (resetError) {
      setError(authErrorMessage(resetError));
    } finally {
      setBusy(false);
    }
  };

  if (checking) {
    return <div className="auth-loading"><LoaderCircle className="spin" size={30} /><span>Sprawdzam sesję…</span></div>;
  }

  if (user) {
    return (
      <>
        <div className="session-bar">
          <span><span className="session-bar__dot" /> {user.email}</span>
          <button type="button" onClick={() => void signOut(auth)}>Wyloguj</button>
        </div>
        {children}
      </>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="brand brand--light">
          <div className="brand__mark"><Beaker size={22} /></div>
          <div><strong>LabFlow</strong><span>Gemini OCR do Excela</span></div>
        </div>
        <div className="auth-story__content">
          <span className="auth-story__eyebrow"><Sparkles size={15} /> Prywatny warsztat danych</span>
          <h1>Wyniki z kartki.<br /><em>Bez przepisywania.</em></h1>
          <p>Zaloguj się, wklej zdjęcie i przenieś sprawdzone dane do swojego układu Excela.</p>
        </div>
        <div className="auth-story__footer"><LockKeyhole size={16} /> Dostęp chroniony przez Firebase Authentication</div>
      </section>

      <section className="auth-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="auth-card__heading">
            <span>Witaj ponownie</span>
            <h2>Zaloguj się do LabFlow</h2>
            <p>To prywatna aplikacja — nowe konta może dodać tylko właściciel.</p>
          </div>

          {error && <div className="auth-message auth-message--error">{error}</div>}
          {notice && <div className="auth-message auth-message--success">{notice}</div>}

          <label className="auth-field">
            <span>Adres e-mail</span>
            <div><Mail size={18} /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nazwa@laboratorium.pl" required /></div>
          </label>
          <label className="auth-field">
            <span>Hasło</span>
            <div><LockKeyhole size={18} /><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Twoje hasło" minLength={6} required /><button type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Ukryj hasło" : "Pokaż hasło"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
          </label>

          <button type="button" className="auth-link auth-link--reset" onClick={() => void resetPassword()} disabled={busy}>Ustaw lub zresetuj hasło</button>

          <button className="button button--primary auth-submit" type="submit" disabled={busy}>
            {busy && <LoaderCircle className="spin" size={18} />}
            {busy ? "Proszę czekać…" : "Zaloguj się"}
          </button>
        </form>
      </section>
    </main>
  );
}
