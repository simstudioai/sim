import { Suspense } from 'react'
import { Metadata } from 'next'
import { WaitlistStatus } from '@/lib/waitlist/service'
import { ClientWaitlistTable } from './waitlist-table'

export const metadata: Metadata = {
  title: 'Waitlist Management | Sim Studio',
  description: 'Manage the waitlist for Sim Studio',
}

interface WaitlistPageProps {
  searchParams: { status?: string }
}

export default function WaitlistPage({ searchParams }: WaitlistPageProps) {
  // Get status from URL or default to pending
  const status = (searchParams.status || 'pending') as WaitlistStatus

  // Determine which tab is active
  const isActive = (tabStatus: string) =>
    status === tabStatus ? 'border-b-2 border-primary font-medium' : 'hover:bg-muted/50'

  return (
    <div className="container py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Waitlist Management</h1>
        <p className="text-muted-foreground mt-2">
          Review and manage users who have signed up for the waitlist.
        </p>
      </div>

      <div className="w-full">
        <div className="mb-8 flex border-b">
          <a href="?status=pending" className={`px-4 py-2 ${isActive('pending')}`}>
            Pending
          </a>
          <a href="?status=approved" className={`px-4 py-2 ${isActive('approved')}`}>
            Approved
          </a>
          <a href="?status=rejected" className={`px-4 py-2 ${isActive('rejected')}`}>
            Rejected
          </a>
        </div>

        <div className="border rounded-md">
          <div className="p-4 border-b">
            <h2 className="text-xl font-semibold">
              {status.charAt(0).toUpperCase() + status.slice(1)} Waitlist Entries
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Manage access to Sim Studio by approving or rejecting waitlist entries.
            </p>
          </div>
          <div className="p-4">
            <Suspense fallback={<p>Loading entries...</p>}>
              <ClientWaitlistTable status={status} />
            </Suspense>
          </div>
        </div>
      </div>
    </div>
  )
}
