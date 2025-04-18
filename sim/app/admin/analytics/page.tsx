import { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth'
import AnalyticsContent from './analytics-content'
import { ErrorBoundary } from '@/app/w/[id]/components/error'

export const metadata: Metadata = {
  title: 'Analytics | Sim Studio',
  description: 'View detailed analytics for Sim Studio',
}

export default async function AnalyticsPage() {
  const session = await getSession()
  
  if (!session?.user?.email) {
    redirect('/login?callbackUrl=/admin/analytics')
  }

  return (
    <div className="flex-1 space-y-4 p-4 md:p-8 pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Analytics</h2>
      </div>
      <ErrorBoundary fallback={
        <div className="rounded-md bg-destructive/10 p-4">
          <h3 className="text-sm font-medium text-destructive">Error loading analytics</h3>
          <div className="mt-2 text-sm text-destructive/90">
            Something went wrong while loading the analytics data. Please try again later.
          </div>
        </div>
      }>
        <AnalyticsContent />
      </ErrorBoundary>
    </div>
  )
} 