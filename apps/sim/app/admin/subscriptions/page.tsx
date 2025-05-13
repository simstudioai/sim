import { Metadata } from 'next'
import { SubscriptionsManager } from './subscriptions'

export const metadata: Metadata = {
  title: 'Subscriptions | Sim Studio',
  description: 'Manage all subscription plans for Sim Studio',
}

export default function SubscriptionsPage() {
  return (
    <>
      <div className="mb-6 px-1">
        <h1 className="text-2xl font-bold tracking-tight">Subscription Management</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          View and manage paid subscription plans: Enterprise, Team, and Pro tiers.
        </p>
      </div>

      <SubscriptionsManager />
    </>
  )
}
