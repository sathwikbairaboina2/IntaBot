import { getAccounts } from "@/lib/api";
import { UploadForm } from "./upload-form";

export const revalidate = 5;

export default async function UploadPage() {
  const accounts = await getAccounts();
  if (accounts.length === 0) return <p>Connect an account first.</p>;
  return <UploadForm accounts={accounts} />;
}
