'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Activity, Box, RefreshCw, Users, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ErrorBoundary } from '@/components/error-boundary'
import { ThemeToggle } from '../components/theme-toggle'
import BlockUsageChart from '../components/BlockUsageChart'
import { UserStatsModal } from '../components/UserStatsModal'
import WorkflowsModal from '../components/WorkflowsModal'
import WorkflowActivityChart from '../components/WorkflowActivityChart'
import LatencyAnalysis from '../components/LatencyAnalysis'
import UserDemographics from '../components/UserDemographics'

interface DashboardData {
  overview: {
    totalWorkflows: number
    activeWorkflows: number
    totalExecutions: number
    avgBlocksPerWorkflow: number
  }
  userDemographics: {
    totalUsers: number
    inactiveUsers: number
    inactivePercentage: number
    usersWithNoWorkflows: number
    usersWithNoRuns: number
    averageWorkflowsPerUser: number
    modifiedAndRan: number
    modifiedAndRanPercentage: number
    modifiedNoRun: number
    modifiedNoRunPercentage: number
    createdMultiple: number
    createdMultiplePercentage: number
    baseStateOnly: number
    baseStateOnlyPercentage: number
    totalSessions: number
    averageSessionsPerUser: number
    returningUsers: number
    returningUsersPercentage: number
    topReturningUsers: Array<{
      name: string
      email: string
      sessionCount: number
      lastSeen: string
    }>
  }
  topUsers: Array<{
    email: string
    name: string
    workflowCount: number
    blockCount: number
    workflows: Array<{
      id: string
      name: string
      created_at: string
      blocks: { type: string }[]
    }>
    blockUsage: Array<{ type: string; count: number }>
    totalBlocks: number
    avgBlocksPerWorkflow: number
    totalCost: number
    executionStats: {
      manual: number
      webhook: number
      scheduled: number
      api: number
    }
  }>
  topBlocks: Array<{
    type: string
    count: number
  }>
  recentActivity: Array<{
    workflow_id: string
    created_at: string
    status: string
  }>
  workflows: Array<{
    id: string
    name: string
    ownerName: string
    blockCount: number
    runCount: number
    isDeployed: boolean
  }>
  blockLatencies: Array<{
    type: string
    avgLatency: number
    p50Latency: number
    p75Latency: number
    p99Latency: number
    p100Latency: number
    samples: number
  }>
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [showWorkflows, setShowWorkflows] = useState(false)

  const fetchDashboardData = async () => {
    try {
      setIsRefreshing(true)
      const response = await fetch('/api/admin/dashboard', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        // Add cache: 'no-store' to prevent caching
        cache: 'no-store',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.message || 'Failed to fetch dashboard data')
      }

      const dashboardData = await response.json()
      setData(dashboardData)
      setError(null)
    } catch (err) {
      console.error('Dashboard fetch error:', err)
      setError(err instanceof Error ? err.message : 'An error occurred while fetching dashboard data')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    fetchDashboardData()
  }, [])

  if (loading) {
    return (
      <main className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button variant="outline" size="icon" disabled>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array(4).fill(0).map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <Skeleton className="h-4 w-[100px]" />
                <Skeleton className="h-4 w-4" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-[100px]" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <Skeleton className="h-6 w-[150px]" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Array(5).fill(0).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card className="col-span-3">
            <CardHeader>
              <Skeleton className="h-6 w-[150px]" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Array(5).fill(0).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  if (error) {
    return (
      <main className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline"
              size="icon"
              onClick={fetchDashboardData}
              disabled={isRefreshing}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="rounded-lg bg-destructive/10 p-4">
          <h3 className="text-sm font-medium text-destructive">Error loading dashboard</h3>
          <div className="mt-2 text-sm text-destructive/90">{error}</div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDashboardData}
            className="mt-4"
            disabled={isRefreshing}
          >
            Retry
          </Button>
        </div>
      </main>
    )
  }

  const handleUserClick = async (email: string) => {
    setSelectedUser(email)
  }

  return (
    <ErrorBoundary fallback={<div>Something went wrong. Please refresh the page.</div>}>
      <main className="flex-1 space-y-4 p-4 md:p-8 pt-6 bg-background">
        <div className="flex items-center justify-between">
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline"
              size="icon"
              onClick={fetchDashboardData}
              disabled={isRefreshing}
              className={isRefreshing ? 'animate-spin' : ''}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        {/* Overview Cards */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => setShowWorkflows(true)}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Workflows</CardTitle>
              <Box className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data?.overview.totalWorkflows ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data?.overview.activeWorkflows ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Executions</CardTitle>
              <Workflow className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data?.overview.totalExecutions ?? 0}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Avg. Blocks/Workflow</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data?.overview.avgBlocksPerWorkflow?.toFixed(1) ?? '0.0'}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Detailed Stats */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
          <Card className="col-span-4">
            <CardHeader>
              <CardTitle>Top Users</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-4">
                  {data?.topUsers.map((user, i) => (
                    <div 
                      key={i} 
                      className="flex items-center justify-between p-2 rounded-lg hover:bg-accent cursor-pointer transition-colors"
                      onClick={() => handleUserClick(user.email)}
                    >
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none capitalize">
                          {user.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {user.workflowCount} {user.workflowCount === 1 ? 'workflow' : 'workflows'}, 
                          {user.blockCount} {user.blockCount === 1 ? 'block' : 'blocks'}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
          <Card className="col-span-3">
            <CardHeader>
              <CardTitle>Most Used Blocks</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                {data?.topBlocks && data.topBlocks.length > 0 ? (
                  <BlockUsageChart
                    blocks={data.topBlocks.map(block => block.type)}
                    count={data.topBlocks.map(block => block.count)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No block usage data available
                  </p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* User Demographics */}
        {!loading && data?.userDemographics && (
          <UserDemographics demographics={data.userDemographics} />
        )}

        {/* Recent Activity */}
        <div className="grid gap-4 md:grid-cols-2">
          <WorkflowActivityChart executions={data?.recentActivity || []} />
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[300px]">
                <div className="space-y-4">
                  {data?.recentActivity.map((log, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium leading-none">
                          Workflow {log.workflow_id}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </p>
                      </div>
                      <div className={`text-sm ${
                        log.status === 'success' ? 'text-green-500' : 
                        log.status === 'error' ? 'text-red-500' : 
                        'text-muted-foreground'
                      }`}>
                        Status: {log.status}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </div>

        {/* Block Latency Analysis */}
        {!loading && data?.blockLatencies && data.blockLatencies.length > 0 && (
          <LatencyAnalysis blockLatencies={data.blockLatencies} />
        )}

        {/* User Stats Modal */}
        {selectedUser && data && (
          <UserStatsModal
            isOpen={!!selectedUser}
            onClose={() => setSelectedUser(null)}
            stats={{
              ...((() => {
                // Look up the selected user data once and store in a variable
                const selectedUserData = data.topUsers.find(u => u.email === selectedUser);
                
                // Return user stats with proper fallbacks for all properties
                return {
                  firstName: selectedUserData?.name || selectedUser.split('@')[0],
                  email: selectedUser,
                  workflowCount: selectedUserData?.workflowCount || 0,
                  blockCount: selectedUserData?.blockCount || 0,
                  workflows: selectedUserData?.workflows || [],
                  blockUsage: selectedUserData?.blockUsage || [],
                  totalBlocks: selectedUserData?.totalBlocks || 0,
                  avgBlocksPerWorkflow: selectedUserData?.avgBlocksPerWorkflow || 0,
                  totalCost: selectedUserData?.totalCost || 0,
                  executionStats: selectedUserData?.executionStats || {
                    manual: 0,
                    webhook: 0,
                    scheduled: 0,
                    api: 0
                  }
                };
              })())
            }}
          />
        )}

        {/* Workflows Modal */}
        <WorkflowsModal
          isOpen={showWorkflows}
          onClose={() => setShowWorkflows(false)}
          workflows={data?.workflows || []}
        />
      </main>
    </ErrorBoundary>
  )
} 