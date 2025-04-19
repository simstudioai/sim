'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Calendar, RefreshCw } from 'lucide-react'

interface DashboardData {
  overview: {
    totalWorkflows: number
    activeWorkflows: number
    totalExecutions: number
    avgBlocksPerWorkflow: number
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

export function DashboardContent() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [timeRange, setTimeRange] = useState('7d')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)

  // Create a reusable function to fetch dashboard data
  const fetchDashboardData = useCallback(async () => {
    try {
      setIsRefreshing(true)
      const response = await fetch('/api/admin/dashboard')
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data')
      }
      const dashboardData = await response.json()
      setData(dashboardData)
      setError(null)
    } catch (err) {
      console.error('Error loading dashboard data:', err)
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  // Initial data load
  useEffect(() => {
    fetchDashboardData()
  }, [timeRange, fetchDashboardData])

  // Handle filter selection
  const handleFilterClick = (filter: string) => {
    setActiveFilter(activeFilter === filter ? null : filter)
    // Here you would typically filter the data based on the selected filter
    // For now, we're just toggling the active state
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading dashboard data...</div>
  }

  if (error) {
    return <div className="flex items-center justify-center h-full text-red-500">{error}</div>
  }

  if (!data) {
    return <div className="flex items-center justify-center h-full">No dashboard data available</div>
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Left Sidebar - Filters */}
      <div className="w-64 border-r bg-background p-4 space-y-4">
        <div>
          <h3 className="text-sm font-medium mb-2">Time Range</h3>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <h3 className="text-sm font-medium mb-2">Quick Filters</h3>
          <div className="space-y-2">
            <Button 
              variant={activeFilter === 'active' ? "default" : "outline"} 
              size="sm" 
              className="w-full justify-start"
              onClick={() => handleFilterClick('active')}
            >
              Active Workflows
            </Button>
            <Button 
              variant={activeFilter === 'recent' ? "default" : "outline"} 
              size="sm" 
              className="w-full justify-start"
              onClick={() => handleFilterClick('recent')}
            >
              Recent Executions
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto">
        {/* Control Bar */}
        <div className="border-b bg-background p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                <Calendar className="h-4 w-4 mr-2" />
                Today
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={fetchDashboardData}
                disabled={isRefreshing}
                className={isRefreshing ? "animate-spin" : ""}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
            </div>
            <div className="flex items-center space-x-2">
              <Button variant="outline" size="sm">
                Export
              </Button>
            </div>
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="p-6 space-y-6">
          {/* Overview Stats */}
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
                <div className="text-2xl font-bold">
                  {data.overview.avgBlocksPerWorkflow != null 
                    ? data.overview.avgBlocksPerWorkflow.toFixed(1) 
                    : '0.0'}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Users Section */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Users</h2>
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Top Users by Workflows</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {data.topUsers.map((user, i) => (
                      <div key={i} className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">{user.email}</span>
                        <span className="font-medium">{user.workflowCount} workflows</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Top Block Types</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {data.topBlocks.map((block, i) => (
                      <div key={i} className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">{block.type}</span>
                        <span className="font-medium">{block.count} uses</span>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Recent Activity */}
          <div>
            <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
            <Card>
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {data.recentActivity.map((activity) => (
                    <div key={activity.id} className="flex justify-between items-center">
                      <div className="flex items-center space-x-4">
                        <div>
                          <p className="text-sm font-medium">Activity ID: {activity.id}</p>
                          {activity.status && (
                            <p className="text-sm text-muted-foreground">Status: {activity.status}</p>
                          )}
                        </div>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {new Date(activity.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
} 