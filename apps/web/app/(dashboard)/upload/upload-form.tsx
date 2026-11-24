"use client";

import {
  CloudUploadOutlined,
  DeleteOutlined,
  FileImageOutlined,
  PaperClipOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { Alert, Button, Select, Upload } from "antd";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { AccountRing, ModeTag } from "@/components/ui";
import { ACCEPTED_MEDIA, fileKind, formatBytes, isAcceptedMedia } from "@/lib/view";

export interface UploadAccount {
  id: string;
  name: string;
  username: string;
  dryRun: boolean;
}

type Result =
  | { kind: "uploaded"; name: string }
  | { kind: "failed"; status: number }
  | { kind: "wrong-type" }
  | null;

export function UploadForm({ accounts }: { accounts: UploadAccount[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file || !accountId) return;
    setBusy(true);
    setResult(null);
    const body = new FormData();
    body.set("accountId", accountId);
    body.set("file", file);
    try {
      const res = await fetch("/api/upload", { method: "POST", body });
      if (res.ok) {
        setResult({ kind: "uploaded", name: file.name });
        setFile(null);
      } else {
        setResult({ kind: "failed", status: res.status });
      }
    } catch {
      setResult({ kind: "failed", status: 0 });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="surface-card upload-card">
      <div>
        <h2>New upload</h2>
        <p className="desc">IntaBot drafts a caption and hashtags, then puts the post in Approvals for you.</p>
      </div>

      <label className="field">
        <span>Account</span>
        <Select
          value={accountId}
          onChange={setAccountId}
          options={accounts.map((a) => ({
            value: a.id,
            label: (
              <span className="select-acct">
                <AccountRing name={a.name} size="sm" />
                <span className="select-user">@{a.username}</span>
                <ModeTag dryRun={a.dryRun} />
              </span>
            ),
          }))}
        />
      </label>

      <div className="field">
        <span>Media</span>
        <div>
          <Upload
            accept={ACCEPTED_MEDIA.join(",")}
            maxCount={1}
            showUploadList={false}
            beforeUpload={(picked) => {
              if (!isAcceptedMedia(picked.type)) {
                setResult({ kind: "wrong-type" });
                return Upload.LIST_IGNORE;
              }
              setFile(picked);
              setResult(null);
              return false;
            }}
          >
            <Button icon={<PaperClipOutlined />}>{file ? "Choose another file" : "Choose file"}</Button>
          </Upload>
          <span className="hint">JPEG, PNG, WebP or MP4</span>
        </div>
        {file ? (
          <div className="file-row">
            <span className="file-icon">{file.type.startsWith("video/") ? <VideoCameraOutlined /> : <FileImageOutlined />}</span>
            <div style={{ minWidth: 0 }}>
              <div className="file-name">{file.name}</div>
              <div className="file-meta num">
                {fileKind(file.type)} · {formatBytes(file.size)}
              </div>
            </div>
            <span className="spacer" />
            <Button type="text" icon={<DeleteOutlined />} aria-label="Remove file" onClick={() => setFile(null)} />
          </div>
        ) : null}
      </div>

      {result?.kind === "uploaded" ? (
        <Alert
          type="success"
          showIcon
          title={
            <>
              Uploaded <b>{result.name}</b>. Drafting has started; the draft appears in Approvals in a minute or so.{" "}
              <Link href="/approvals">Go to Approvals →</Link>
            </>
          }
        />
      ) : null}
      {result?.kind === "failed" ? (
        <Alert
          type="error"
          showIcon
          title={result.status ? `Upload failed (HTTP ${result.status}).` : "Upload failed: the server didn't answer."}
        />
      ) : null}
      {result?.kind === "wrong-type" ? <Alert type="error" showIcon title="Choose a JPEG, PNG, WebP or MP4 file." /> : null}

      <div>
        <Button type="primary" htmlType="submit" icon={<CloudUploadOutlined />} loading={busy} disabled={!file || !accountId}>
          Upload
        </Button>
      </div>

      <div className="steps" aria-label="What happens next">
        <span><b>1</b>Upload</span>
        <span><b>2</b>IntaBot drafts</span>
        <span><b>3</b>You approve</span>
        <span><b>4</b>It posts at the slot</span>
      </div>
    </form>
  );
}
