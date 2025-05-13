'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { DashboardCard, StatItem } from '../dashboard-card/dashboard-card'

interface UsageStats {
  totalApiCalls: number
  totalTokensUsed: number
  totalWebhookTriggers: number
  totalManualExecutions: number
  totalScheduledExecutions: number
  chatExecutions: number
  registeredWebhooksCount: number
  schedulesCreatedCount: number
  chatInterfacesCount: number
  totalCost: number
  apiKeysCount: number
  marketplaceViews: number
  publishedWorkflowsCount: number
  totalWorkflowRuns: number
  customToolsCount: number
  workspacesCount: number
  organizationsCount: number
  membersCount: number
  recentlyActiveUsersCount: number
  executionData: Record<string, number>
  subscriptionData: Record<string, number>
}

interface State {
  stats: UsageStats | null
  loading: boolean
  error: string | null
}

interface UsageStatsCardProps {
  view?: 'overview' | 'usage' | 'users' | 'platform'
}

export function UsageStatsCard({ view = 'overview' }: UsageStatsCardProps) {
  const [state, setState] = useState<State>({
    stats: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = sessionStorage.getItem('admin-auth-token') || ''
        const response = await fetch('/api/admin/usage', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          cache: 'no-store',
        })

        if (!response.ok) {
          throw new Error('Failed to fetch usage stats')
        }

        const data = await response.json()
        if (data.success) {
          setState({
            stats: data.stats,
            loading: false,
            error: null,
          })
        } else {
          throw new Error(data.message || 'Failed to fetch usage stats')
        }
      } catch (err) {
        console.error('Error fetching usage stats:', err)
        setState({
          stats: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      }
    }

    fetchStats()
  }, [])

  // Format the subscription data for display
  const formatSubscriptions = (data: Record<string, number>) => {
    return Object.entries(data)
      .map(([plan, count]) => `${plan}: ${count}`)
      .join(', ')
  }

  // Loading and error states
  if (state.loading) {
    return (
      <DashboardCard title="Usage Statistics" description="Loading data...">
        <div className="space-y-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            <StatItem value="" label="Tokens Used" loading={true} />
            <StatItem value="" label="Total Cost" loading={true} />
            <StatItem value="" label="Total Executions" loading={true} />
            <StatItem value="" label="Active Users" loading={true} />
          </div>

          <div className="mt-4">
            <h3 className="text-lg font-semibold mb-2">
              <Skeleton className="h-6 w-32" />
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          </div>
        </div>
      </DashboardCard>
    )
  }

  if (state.error) {
    return (
      <DashboardCard
        title="Error Loading Stats"
        description="There was a problem fetching statistics"
      >
        <div className="text-red-500 p-4">{state.error}</div>
      </DashboardCard>
    )
  }

  if (!state.stats) {
    return null
  }

  // At this point, state.stats is definitely not null, so we can use the non-null assertion
  const stats = state.stats

  // Render content based on the active view
  const renderView = () => {
    switch (view) {
      case 'overview':
        return (
          <div className="space-y-6">
            {/* Key metrics for the overview */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              <StatItem value={formatNumber(stats.totalTokensUsed)} label="Tokens Used" />
              <StatItem value={`$${stats.totalCost?.toFixed(2) || '0.00'}`} label="Total Cost" />
              <StatItem value={formatNumber(stats.totalWorkflowRuns)} label="Total Executions" />
              <StatItem
                value={formatNumber(stats.recentlyActiveUsersCount)}
                label="Active Users (7d)"
              />
            </div>
          </div>
        )

      case 'usage':
        return (
          <div className="space-y-6">
            {/* Usage Metrics Section */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Primary Usage</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                <StatItem value={formatNumber(stats.totalTokensUsed)} label="Tokens Used" />
                <StatItem value={`$${stats.totalCost?.toFixed(2) || '0.00'}`} label="Total Cost" />
                <StatItem
                  value={formatNumber(stats.totalWorkflowRuns)}
                  label="Total Workflow Runs"
                />
              </div>
            </div>

            {/* Execution Types Section */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Execution Types</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                <StatItem value={formatNumber(stats.totalApiCalls)} label="API" />
                <StatItem value={formatNumber(stats.totalManualExecutions)} label="Manual" />
                <StatItem value={formatNumber(stats.totalScheduledExecutions)} label="Scheduled" />
                <StatItem value={formatNumber(stats.totalWebhookTriggers)} label="Webhook" />
                <StatItem value={formatNumber(stats.chatExecutions)} label="Chat" />
              </div>
            </div>

            {/* Integrations Section */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Integrations</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <StatItem
                  value={formatNumber(stats.registeredWebhooksCount)}
                  label="Webhooks Created"
                />
                <StatItem
                  value={formatNumber(stats.schedulesCreatedCount)}
                  label="Schedules Created"
                />
                <StatItem value={formatNumber(stats.chatInterfacesCount)} label="Chat Interfaces" />
              </div>
            </div>
          </div>
        )

      case 'users':
        return (
          <div className="space-y-6">
            {/* Subscription Information */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Subscription Information</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                <StatItem
                  value={
                    stats.subscriptionData
                      ? Object.keys(stats.subscriptionData).length.toString()
                      : '0'
                  }
                  label="Subscription Plans"
                  description={
                    stats.subscriptionData ? formatSubscriptions(stats.subscriptionData) : 'None'
                  }
                />
                <StatItem value={formatNumber(stats.organizationsCount)} label="Organizations" />
                <StatItem value={formatNumber(stats.membersCount)} label="Organization Members" />
              </div>
            </div>

            {/* User Activity */}
            <div>
              <h3 className="text-lg font-semibold mb-2">User Activity</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                <StatItem
                  value={formatNumber(stats.recentlyActiveUsersCount)}
                  label="Active Users (7d)"
                />
                <StatItem value={formatNumber(stats.workspacesCount)} label="Workspaces" />
              </div>
            </div>
          </div>
        )

      case 'platform':
        return (
          <div className="space-y-6">
            {/* Platform Features */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Platform Features</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                <StatItem value={formatNumber(stats.apiKeysCount)} label="API Keys" />
                <StatItem value={formatNumber(stats.customToolsCount)} label="Custom Tools" />
                <StatItem
                  value={formatNumber(stats.publishedWorkflowsCount)}
                  label="Published Workflows"
                />
                <StatItem value={formatNumber(stats.marketplaceViews)} label="Marketplace Views" />
              </div>
            </div>
          </div>
        )
    }
  }

  return (
    <DashboardCard title={getCardTitle(view)} description={getCardDescription(view)}>
      {renderView()}
    </DashboardCard>
  )
}

// Helper functions to get titles and descriptions
function getCardTitle(view: string): string {
  switch (view) {
    case 'overview':
      return 'Key Metrics'
    case 'usage':
      return 'Usage Statistics'
    case 'users':
      return 'User & Subscription Data'
    case 'platform':
      return 'Platform Features'
    default:
      return 'Usage Statistics'
  }
}

function getCardDescription(view: string): string {
  switch (view) {
    case 'overview':
      return 'Most important usage metrics'
    case 'usage':
      return 'Detailed usage and execution metrics'
    case 'users':
      return 'User activity and subscription details'
    case 'platform':
      return 'Platform features and integrations'
    default:
      return 'Platform usage metrics'
  }
}

// Helper function to format numbers with commas
function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num)
}
