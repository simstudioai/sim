import PasswordAuth from './password-auth'

export default function AdminPage() {
  return (
    <PasswordAuth>
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 md:px-8 py-6">
        <div className="mb-6 px-1">
          <h1 className="text-2xl font-bold tracking-tight">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Manage Sim Studio platform settings and users.
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <a 
            href="/admin/waitlist" 
            className="border border-gray-200 dark:border-gray-800 rounded-md p-4 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors"
          >
            <h2 className="text-lg font-medium">Waitlist Management</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Review and manage users on the waitlist
            </p>
          </a>
        </div>
      </div>
    </PasswordAuth>
  )
}
