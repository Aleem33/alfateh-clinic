export function RoleAccessDenied({ onLogout }: { onLogout?: () => void }) {
  return <div className="p-8 bg-white rounded-xl m-6">
    <h1 className="text-xl font-bold">This account does not have access to this application</h1>
    <p className="my-4">Use the appropriate application or ask an administrator to check your assigned role. No records have been changed.</p>
    <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={onLogout}>Back to sign in</button>
  </div>;
}
