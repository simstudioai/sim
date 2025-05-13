'use client'

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AddEnterpriseForm } from './components/add-enterprise-form'
import { SubscriptionAlert, useSubscriptionAlert } from './components/subscription-alert'
import { SubscriptionData, SubscriptionList } from './components/subscription-list'

export function SubscriptionsManager() {
  const [allSubscriptions, setAllSubscriptions] = useState<SubscriptionData[]>([])
  const [loading, setLoading] = useState(true)

  // Use our subscription alert hook
  const { alert, hideAlert, successAlert, errorAlert } = useSubscriptionAlert()

  // Filtered subscriptions by plan type
  const enterpriseSubscriptions = allSubscriptions.filter((sub) => sub.plan === 'enterprise')
  const teamSubscriptions = allSubscriptions.filter((sub) => sub.plan === 'team')
  const proSubscriptions = allSubscriptions.filter((sub) => sub.plan === 'pro')

  const fetchSubscriptions = async () => {
    try {
      setLoading(true)

      // Get admin auth token
      const token = sessionStorage.getItem('admin-auth-token') || ''
      if (!token) {
        throw new Error('Authentication token missing')
      }

      // Fetch all subscriptions (excluding free tier by default)
      const response = await fetch('/api/admin/subscriptions', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, must-revalidate',
        },
      })

      if (response.status === 401) {
        throw new Error('Unauthorized: Please log in again')
      }

      if (!response.ok) {
        throw new Error('Failed to fetch subscriptions')
      }

      const data = await response.json()

      if (!data.success) {
        throw new Error(data.message || 'Failed to load subscriptions')
      }

      setAllSubscriptions(data.data || [])
    } catch (error) {
      console.error('Error fetching subscriptions:', error)
      errorAlert(error instanceof Error ? error.message : 'Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchSubscriptions()
  }, [])

  const handleSubscriptionCreated = () => {
    successAlert('Subscription created successfully')
    fetchSubscriptions()
  }

  return (
    <>
      {alert.show && (
        <SubscriptionAlert type={alert.type} message={alert.message} onClose={hideAlert} />
      )}

      <Tabs defaultValue="all" className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="all">All Plans</TabsTrigger>
          <TabsTrigger value="enterprise">Enterprise</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="pro">Pro</TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-8">
          <div className="grid grid-cols-1 gap-6">
            <SubscriptionList
              title="All Subscriptions"
              description="Active and inactive subscriptions across all paid plans"
              subscriptions={allSubscriptions}
              loading={loading}
              emptyMessage="No subscriptions found"
            />
          </div>
        </TabsContent>

        <TabsContent value="enterprise" className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <SubscriptionList
                title="Enterprise Subscriptions"
                description="Active enterprise subscriptions with unlimited log retention and higher limits"
                subscriptions={enterpriseSubscriptions}
                loading={loading}
                emptyMessage="No enterprise subscriptions found"
              />
            </div>

            <AddEnterpriseForm onSuccess={handleSubscriptionCreated} onError={errorAlert} />
          </div>
        </TabsContent>

        <TabsContent value="team" className="space-y-8">
          <div className="grid grid-cols-1 gap-6">
            <SubscriptionList
              title="Team Subscriptions"
              description="Team plans with collaboration features and extended resource limits"
              subscriptions={teamSubscriptions}
              loading={loading}
              emptyMessage="No team subscriptions found"
            />
          </div>
        </TabsContent>

        <TabsContent value="pro" className="space-y-8">
          <div className="grid grid-cols-1 gap-6">
            <SubscriptionList
              title="Pro Subscriptions"
              description="Professional subscriptions with advanced features"
              subscriptions={proSubscriptions}
              loading={loading}
              emptyMessage="No pro subscriptions found"
            />
          </div>
        </TabsContent>
      </Tabs>
    </>
  )
}
