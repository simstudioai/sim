'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/lib/auth-client'
import Chart from '../charts/charts'
import { useEffect, useState } from 'react'
import { format } from 'date-fns'

interface DashboardData {
  overview: {
    totalWorkflows: number
    activeWorkflows: number
    totalExecutions: number
    avgBlocksPerWorkflow: number | null
  }
  topUsers: Array<{
    email: string
    workflowCount: number
    blockCount: number
  }>
  topBlocks: Array<{
    type: string
    count: number
  }>
  recentActivity: Array<{
    id: string
    status?: string
    created_at: string
  }>
}

export function AnalyticsDashboard() {
  const { data: session } = useSession()
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadAnalytics = async () => {
      if (!session?.user) return
      setLoading(true)
      try {
        const response = await fetch(`/api/admin/dashboard?timeRange=${timeRange}`)
        if (!response.ok) {
          throw new Error('Failed to fetch analytics data')
        }
        const analyticsData = await response.json()
        setData(analyticsData)
        setError(null)
      } catch (err) {
        console.error('Error loading analytics:', err)
        setError(err instanceof Error ? err.message : 'Failed to load analytics data')
      } finally {
        setLoading(false)
      }
    }

    loadAnalytics()
  }, [session?.user, timeRange])

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading analytics...</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-500">{error}</div>
  }

  if (!data) {
    return <div className="flex items-center justify-center h-full">No analytics data available</div>
  }

  const formatAvgBlocks = (value: number | null) => {
    if (value === null || value === undefined) return 'N/A'
    return value.toFixed(1)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold tracking-tight">Analytics Dashboard</h2>
        <Tabs value={timeRange} onValueChange={(value) => setTimeRange(value as '7d' | '30d')}>
          <TabsList>
            <TabsTrigger value="7d">Last 7 Days</TabsTrigger>
            <TabsTrigger value="30d">Last 30 Days</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Overview Section */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.overview.totalWorkflows}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.overview.activeWorkflows}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Executions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data.overview.totalExecutions}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Blocks/Workflow</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatAvgBlocks(data.overview.avgBlocksPerWorkflow)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Users Section */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Users by Workflow Count</CardTitle>
          </CardHeader>
          <CardContent>
            <Chart
              type="bar"
              data={{
                labels: data.topUsers.map(user => user.email),
                datasets: [{
                  label: 'Workflows',
                  data: data.topUsers.map(user => user.workflowCount),
                  backgroundColor: 'rgba(59, 130, 246, 0.5)',
                }],
              }}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Top Block Types</CardTitle>
          </CardHeader>
          <CardContent>
            <Chart
              type="bar"
              data={{
                labels: data.topBlocks.map(block => block.type),
                datasets: [{
                  label: 'Usage Count',
                  data: data.topBlocks.map(block => block.count),
                  backgroundColor: 'rgba(16, 185, 129, 0.5)',
                }],
              }}
            />
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {data.recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Activity ID: {activity.id}</p>
                  {activity.status && (
                    <p className="text-sm text-muted-foreground">Status: {activity.status}</p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(activity.created_at), 'MMM d, yyyy HH:mm')}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
} 