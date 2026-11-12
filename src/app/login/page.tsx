"use client";

import { useState } from "react";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    setBusy(false);
    if (res.ok) {
      const next = new URLSearchParams(location.search).get("next");
      location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    }
    else setError((await res.json()).error ?? "로그인 실패");
  }

  return (
    <form className="card login" onSubmit={submit}>
      <h1>재고 알리미</h1>
      <input className="input" type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      <button className="btn primary" style={{ width: "100%", marginTop: 10 }} disabled={busy}>
        {busy ? "확인 중…" : "로그인"}
      </button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
