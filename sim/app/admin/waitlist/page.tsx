import { Metadata } from 'next'
import PasswordAuth from '../password-auth'
import { WaitlistTable } from './waitlist-table'

export const metadata: Metadata = {
  title: 'Waitlist Management | Sim Studio',
  description: 'Manage the waitlist for Sim Studio',
}

export default function WaitlistPage() {
  return (
    <PasswordAuth>
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 md:px-8 py-10">
        <div className="mb-8 px-1">
          <h1 className="text-3xl font-bold tracking-tight">Waitlist Management</h1>
          <p className="text-muted-foreground mt-2">
            Review and manage users who have signed up for the waitlist.
          </p>
        </div>

        <div className="w-full border-none shadow-md bg-white dark:bg-gray-950 rounded-md">
          <WaitlistTable />
        </div>
      </div>
    </PasswordAuth>
  )
}
