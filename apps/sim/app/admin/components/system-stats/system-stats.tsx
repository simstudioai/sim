'use client'

import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DashboardCard, StatItem } from '../dashboard-card/dashboard-card'

interface SystemStats {
  totalUsers: number
  activeUsers: number
  totalWorkflows: number
  totalExecutions: number
  uptime: string
  period?: string
}

interface State {
  stats: SystemStats | null
  loading: boolean
  error: string | null
}

type ActiveUserPeriod = '24h' | '7d' | '30d'

export function SystemStatsCard() {
  const [state, setState] = useState<State>({
    stats: null,
    loading: true,
    error: null,
  })
  const [activePeriod, setActivePeriod] = useState<ActiveUserPeriod>('24h')

  useEffect(() => {
    fetchStats()
  }, [activePeriod])

  if (state.error) {
    return (
      <DashboardCard title="System Status" description="Error loading system statistics">
        <div className="flex flex-col h-full">
          <div className="text-red-500 p-4 flex-grow">{state.error}</div>
          <div className="mt-4 pt-4 border-t">
            <Button variant="outline" size="sm" className="w-full" onClick={fetchStats}>
              <RefreshCw className="mr-2 h-4 w-4" /> Retry
            </Button>
          </div>
        </div>
      </DashboardCard>
    )
  }

  // Calculate user activity percentage
  const userActivityPercentage =
    state.stats && !state.loading
      ? Math.round((state.stats.activeUsers / Math.max(state.stats.totalUsers, 1)) * 100)
      : 0

  // Parse uptime percentage
  const uptimeValue = state.stats?.uptime ? parseFloat(state.stats.uptime.replace('%', '')) : 0

  return (
    <DashboardCard title="System Status">
      <div className="flex flex-col h-full justify-between">
        {state.loading ? (
          <>
            <div className="flex-1 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <StatItem value="" label="Uptime" loading={true} />
                <StatItem value="" label="Active Users" loading={true} />
              </div>

              <div className="flex justify-between items-center text-sm mt-3">
                <span>Total Workflows:</span>
                <Skeleton className="h-5 w-20" />
              </div>

              <div className="flex justify-between items-center text-sm">
                <span>Total Executions:</span>
                <Skeleton className="h-5 w-20" />
              </div>

              {/* Add spacer div */}
              <div className="h-6"></div>
            </div>
            <div className="mt-auto pt-6 border-t">
              <Button variant="outline" size="sm" className="w-full" disabled>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                <Skeleton className="h-4 w-16" />
              </Button>
            </div>
          </>
        ) : state.stats ? (
          <>
            <div className="flex-1 space-y-4">
              {/* Key stats */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Active Users:</span>
                <div className="flex space-x-1 border rounded-md overflow-hidden">
                  <Button
                    variant={activePeriod === '24h' ? 'default' : 'ghost'}
                    size="sm"
                    className="rounded-none h-7 px-2"
                    onClick={() => setActivePeriod('24h')}
                  >
                    24h
                  </Button>
                  <Button
                    variant={activePeriod === '7d' ? 'default' : 'ghost'}
                    size="sm"
                    className="rounded-none h-7 px-2"
                    onClick={() => setActivePeriod('7d')}
                  >
                    Weekly
                  </Button>
                  <Button
                    variant={activePeriod === '30d' ? 'default' : 'ghost'}
                    size="sm"
                    className="rounded-none h-7 px-2"
                    onClick={() => setActivePeriod('30d')}
                  >
                    Monthly
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <StatItem value={formatNumber(state.stats.activeUsers)} label="Active Users" />
                <StatItem value={formatNumber(state.stats.totalUsers)} label="Total Users" />
              </div>

              <div className="flex justify-between items-center text-sm mt-3">
                <span>Total Workflows:</span>
                <span className="font-semibold">{formatNumber(state.stats.totalWorkflows)}</span>
              </div>

              <div className="flex justify-between items-center text-sm">
                <span>Total Executions:</span>
                <span className="font-semibold">{formatNumber(state.stats.totalExecutions)}</span>
              </div>

              <div className="h-6"></div>
            </div>

            <div className="mt-auto pt-6 border-t">
              <Button variant="outline" size="sm" className="w-full" onClick={refreshStats}>
                <RefreshCw className="mr-2 h-4 w-4" /> Refresh Stats
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </DashboardCard>
  )

  function refreshStats() {
    setState((prev) => ({ ...prev, loading: true }))
    fetchStats()
  }

  // Helper function to fetch stats (to be used by the refresh button)
  function fetchStats() {
    const token = sessionStorage.getItem('admin-auth-token') || ''
    fetch(`/api/admin/system?period=${activePeriod}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Failed to fetch system stats')
        }
        return response.json()
      })
      .then((data) => {
        if (data.success) {
          console.log('Received stats for period:', data.stats.period)
          setState({
            stats: data.stats,
            loading: false,
            error: null,
          })
        } else {
          throw new Error(data.message || 'Failed to fetch system stats')
        }
      })
      .catch((err) => {
        console.error('Error fetching system stats:', err)
        setState({
          stats: null,
          loading: false,
          error: err instanceof Error ? err.message : 'Unknown error',
        })
      })
  }
}

// Helper function to format numbers with commas
function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num)
}
