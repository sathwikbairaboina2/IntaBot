"use client";

import { useState, type FormEvent } from "react";
import type { AccountView } from "@/lib/api";

export function UploadForm({ accounts }: { accounts: AccountView[] }) {
  const [status, setStatus] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("Uploading…");
    const res = await fetch("/api/upload", {
      method: "POST",
      body: new FormData(event.currentTarget),
    });
    setStatus(res.ok ? "Uploaded. Drafting has started." : "Upload failed.");
  }

  return (
    <form onSubmit={onSubmit}>
      <label>
        Account
        <select name="accountId">
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              @{a.username}
            </option>
          ))}
        </select>
      </label>
      <label>
        File
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp,video/mp4"
          required
        />
      </label>
      <button type="submit">Upload</button>
      {status ? <p>{status}</p> : null}
    </form>
  );
}
