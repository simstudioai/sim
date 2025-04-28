import { Metadata } from 'next'
import PasswordAuth from '../password-auth'
import { WaitlistTable } from './waitlist'

export const metadata: Metadata = {
  title: 'Waitlist Management | Sim Studio',
  description: 'Manage the waitlist for Sim Studio',
}

export default function WaitlistPage() {
  return (
    <PasswordAuth>
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 md:px-8 py-6">
        <div className="mb-6 px-1">
          <h1 className="text-2xl font-bold tracking-tight">Waitlist Management</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Review and manage users who have signed up for the waitlist.
          </p>
        </div>

        <div className="w-full border border-gray-200 dark:border-gray-800 shadow-sm bg-white dark:bg-gray-950 rounded-md overflow-hidden">
          <WaitlistTable />
        </div>
      </div>
    </PasswordAuth>
  )
}
