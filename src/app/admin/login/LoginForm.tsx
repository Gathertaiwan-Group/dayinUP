"use client";

import { useActionState } from "react";
import { loginAction } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action}>
      {state?.error ? <div className="adm-flash err">{state.error}</div> : null}
      <div className="adm-field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.email || ""} key={state?.email || ""} />
      </div>
      <div className="adm-field">
        <label htmlFor="password">密碼</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="adm-btn pri" type="submit" disabled={pending} style={{ width: "100%", justifyContent: "center" }}>
        {pending ? "登入中…" : "登入"}
      </button>
    </form>
  );
}
