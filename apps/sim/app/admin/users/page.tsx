import { Metadata } from 'next'
import { UserStatsTable } from './users'

export const metadata: Metadata = {
  title: 'User Statistics | Sim Studio',
  description: 'Manage user statistics and token usage for Sim Studio',
}

export default function UserStatsPage() {
  return (
    <>
      <div className="mb-6 px-1">
        <h1 className="text-2xl font-bold tracking-tight">User Statistics</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Monitor user token usage, API calls, and subscription budgets.
        </p>
      </div>

      <div className="w-full border border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-gray-950 rounded-md overflow-hidden">
        <UserStatsTable />
      </div>
    </>
  )
}
