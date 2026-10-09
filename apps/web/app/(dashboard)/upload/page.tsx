import type { Metadata } from "next";
import { NeedAccount } from "@/components/ui";
import { getAccounts } from "@/lib/queries";
import { UploadForm } from "./upload-form";

export const metadata: Metadata = { title: "Upload" };

export const revalidate = 5;

export default async function UploadPage() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return <NeedAccount />;
  return (
    <UploadForm
      accounts={accounts.map((a) => ({ id: a.id, name: a.name, username: a.username, dryRun: a.dryRun }))}
    />
  );
}
