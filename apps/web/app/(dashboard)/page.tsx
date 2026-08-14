import { getAccounts } from "@/lib/api";

export default async function AccountsPage() {
  const accounts = await getAccounts();

  if (accounts.length === 0) {
    return <p>No accounts connected yet.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Username</th>
          <th>Status</th>
          <th>Dry run</th>
          <th>Token expires</th>
        </tr>
      </thead>
      <tbody>
        {accounts.map((account) => (
          <tr key={account.id}>
            <td>{account.name}</td>
            <td>@{account.username}</td>
            <td>{account.status}</td>
            <td>{account.dryRun ? "on" : "off"}</td>
            <td>{new Date(account.tokenExpiresAt).toLocaleDateString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
