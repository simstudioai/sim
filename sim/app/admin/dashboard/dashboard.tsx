'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Activity, Box, RefreshCw, Users, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import BlockUsageChart from '@/app/admin/components/BlockUsageChart'
import { UserStatsModal } from '@/app/admin/components/UserStatsModal'
import WorkflowsModal from '@/app/admin/components/WorkflowsModal'
import { ThemeToggle } from '../components/theme-toggle'
import WorkflowActivityChart from '../components/WorkflowActivityChart'

interface DashboardData {
  overview: {
    totalWorkflows: number
    activeWorkflows: number
    totalExecutions: number
    avgBlocksPerWorkflow: number
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
      const response = await fetch('/api/admin/dashboard')
      if (!response.ok) throw new Error('Failed to fetch dashboard data')
      const dashboardData = await response.json()
      setData(dashboardData)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
      setIsRefreshing(false)
    }
  }

  const fetchUserStats = async (email: string) => {
    try {
      const response = await fetch(`/api/admin/users/${encodeURIComponent(email)}/stats`)
      if (!response.ok) throw new Error('Failed to fetch user stats')
      return await response.json()
    } catch (error) {
      console.error('Error fetching user stats:', error)
      return null
    }
  }

  useEffect(() => {
    fetchDashboardData()
  }, [])

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg bg-destructive/10 p-4">
          <h3 className="text-sm font-medium text-destructive">Error loading dashboard</h3>
          <div className="mt-2 text-sm text-destructive/90">{error}</div>
        </div>
      </div>
    )
  }

  const handleUserClick = async (email: string) => {
    setSelectedUser(email)
  }

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
            className={isRefreshing ? 'animate-spin' : ''}
          >
            <RefreshCw className="h-4 w-4" />
            <span className="sr-only">Refresh dashboard</span>
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
            {loading ? (
              <Skeleton className="h-8 w-[100px]" />
            ) : (
              <div className="text-2xl font-bold">{data?.overview.totalWorkflows}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Workflows</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-[100px]" />
            ) : (
              <div className="text-2xl font-bold">{data?.overview.activeWorkflows}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Executions</CardTitle>
            <Workflow className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-[100px]" />
            ) : (
              <div className="text-2xl font-bold">{data?.overview.totalExecutions}</div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Blocks/Workflow</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-[100px]" />
            ) : (
              <div className="text-2xl font-bold">
                {data?.overview.avgBlocksPerWorkflow.toFixed(1)}
              </div>
            )}
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
            {loading ? (
              <div className="space-y-2">
                {Array(5).fill(0).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : (
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
            )}
          </CardContent>
        </Card>
        <div className="col-span-3">
          {loading ? (
            <Card>
              <CardContent className="p-6">
                <div className="space-y-2">
                  {Array(5).fill(0).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : (
            data?.topBlocks && data.topBlocks.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>Most Used Blocks</CardTitle>
                </CardHeader>
                <CardContent>
                  <BlockUsageChart
                    blocks={data.topBlocks.map(block => block.type)}
                    count={data.topBlocks.map(block => block.count)}
                  />
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-6">
                  <p className="text-sm text-muted-foreground">
                    No block usage data available
                  </p>
                </CardContent>
              </Card>
            )
          )}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="grid gap-4 md:grid-cols-2">
        <WorkflowActivityChart executions={data?.recentActivity || []} />
        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array(5).fill(0).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-full" />
                ))}
              </div>
            ) : (
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
            )}
          </CardContent>
        </Card>
      </div>

      {/* User Stats Modal */}
      {selectedUser && (
        <UserStatsModal
          isOpen={!!selectedUser}
          onClose={() => setSelectedUser(null)}
          stats={{
            firstName: data?.topUsers.find(u => u.email === selectedUser)?.name || selectedUser.split('@')[0],
            email: selectedUser,
            workflowCount: data?.topUsers.find(u => u.email === selectedUser)?.workflowCount || 0,
            blockCount: data?.topUsers.find(u => u.email === selectedUser)?.blockCount || 0,
            workflows: data?.topUsers.find(u => u.email === selectedUser)?.workflows || [],
            blockUsage: data?.topUsers.find(u => u.email === selectedUser)?.blockUsage || [],
            totalBlocks: data?.topUsers.find(u => u.email === selectedUser)?.totalBlocks || 0,
            avgBlocksPerWorkflow: data?.topUsers.find(u => u.email === selectedUser)?.avgBlocksPerWorkflow || 0,
            totalCost: data?.topUsers.find(u => u.email === selectedUser)?.totalCost || 0,
            executionStats: data?.topUsers.find(u => u.email === selectedUser)?.executionStats || {
              manual: 0,
              webhook: 0,
              scheduled: 0,
              api: 0
            }
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
  )
} 