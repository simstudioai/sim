import { Metadata } from 'next'
import PasswordAuth from '../password-auth'
import { AnalyticsDashboard } from '../dashboard/analytics-dashboard'

export const metadata: Metadata = {
  title: 'Analytics | Sim Studio',
  description: 'View detailed analytics for Sim Studio',
}

export default function AnalyticsPage() {
  return (
    <PasswordAuth>
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 md:px-8 py-10">
        <div className="mb-8 px-1">
          <h1 className="text-3xl font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-2">
            View detailed analytics and insights for your Sim Studio instance.
          </p>
        </div>

        <div className="w-full border-none shadow-md bg-white dark:bg-gray-950 rounded-md p-6">
          <AnalyticsDashboard />
        </div>
      </div>
    </PasswordAuth>
  )
} 