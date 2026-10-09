"use client";

import { RobotOutlined } from "@ant-design/icons";
import { Alert, Button, Input } from "antd";
import { useActionState } from "react";
import { login } from "./actions";

export default function LoginPage() {
  const [error, formAction, pending] = useActionState(login, null);

  return (
    <main className="center-page login-page">
      <div className="login-box">
        <h1 className="login-mark">
          insta<span className="grad-text">bot</span>
        </h1>
        <p className="login-tagline">Sign in to run your Instagram accounts.</p>
        <form action={formAction} className="surface-card login-card">
          <label className="field">
            <span>Email</span>
            <Input name="email" type="email" required autoComplete="username" size="large" autoFocus />
          </label>
          <label className="field">
            <span>Password</span>
            <Input.Password name="password" required autoComplete="current-password" size="large" />
          </label>
          {error ? <Alert type="error" showIcon title={error} /> : null}
          <Button type="primary" htmlType="submit" size="large" block loading={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        <p className="login-foot">
          <span className="logo-square sm"><RobotOutlined /></span>
          IntaBot · operators only
        </p>
      </div>
    </main>
  );
}
