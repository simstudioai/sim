'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Terminal, Webhook, Clock, Globe, Box } from 'lucide-react'
import BlockUsageChart from './BlockUsageChart'
import WorkflowList from './WorkflowList'
import { Skeleton } from '@/components/ui/skeleton'
import { Workflow } from '@/app/api/admin/dashboard/types'

interface UserStats {
  firstName: string
  email: string
  workflowCount: number
  blockCount: number
  workflows: Workflow[]
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
}

interface UserStatsModalProps {
  isOpen: boolean
  onClose: () => void
  stats: UserStats
}

export function UserStatsModal({ isOpen, onClose, stats }: UserStatsModalProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fullStats, setFullStats] = useState<UserStats | null>(null)

  useEffect(() => {
    if (isOpen && stats.email) {
      setLoading(true)
      fetch(`/api/admin/users/${encodeURIComponent(stats.email)}/stats`)
        .then(res => {
          if (!res.ok) throw new Error('Failed to fetch user stats')
          return res.json()
        })
        .then(data => {
          setFullStats(data)
          setError(null)
        })
        .catch(err => {
          console.error('Error fetching user stats:', err)
          setError(err.message)
        })
        .finally(() => {
          setLoading(false)
        })
    }
  }, [isOpen, stats.email])

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{stats.firstName}'s Statistics</DialogTitle>
        </DialogHeader>

        {error ? (
          <div className="rounded-lg bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {/* Workflow Stats */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Workflow Stats</CardTitle>
                <Box className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Workflows:</span>
                    <span className="font-medium">{stats.workflowCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Blocks:</span>
                    <span className="font-medium">{stats.blockCount}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Execution Stats */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Execution Stats</CardTitle>
                <Terminal className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Manual:</span>
                    </div>
                    <span className="font-medium">{stats.executionStats.manual}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Webhook className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Webhook:</span>
                    </div>
                    <span className="font-medium">{stats.executionStats.webhook}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Scheduled:</span>
                    </div>
                    <span className="font-medium">{stats.executionStats.scheduled}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Globe className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">API:</span>
                    </div>
                    <span className="font-medium">{stats.executionStats.api}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Most Used Blocks */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>Most Used Blocks</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-2">
                    {Array(5).fill(0).map((_, i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : fullStats?.blockUsage && fullStats.blockUsage.length > 0 ? (
                  <BlockUsageChart
                    blocks={fullStats.blockUsage.map(b => b.type)}
                    count={fullStats.blockUsage.map(b => b.count)}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No block usage data available</p>
                )}
              </CardContent>
            </Card>

            {/* Workflows */}
            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle>
                  Workflows ({loading ? '...' : fullStats?.workflows.length || 0})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <WorkflowList
                  workflows={fullStats?.workflows || []}
                  loading={loading}
                />
              </CardContent>
            </Card>

            {/* Block Stats */}
            <Card>
              <CardHeader>
                <CardTitle>Block Statistics</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <p className="text-2xl font-bold">{fullStats?.totalBlocks || 0}</p>
                      <p className="text-sm text-muted-foreground">Total Blocks Used</p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold">
                        {fullStats?.avgBlocksPerWorkflow.toFixed(1) || '0.0'}
                      </p>
                      <p className="text-sm text-muted-foreground">Average Blocks per Workflow</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cost */}
            <Card>
              <CardHeader>
                <CardTitle>Cost</CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-4">
                    <Skeleton className="h-8 w-16" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div>
                      <p className="text-2xl font-bold">
                        ${(fullStats?.totalCost || 0).toFixed(4)} USD
                      </p>
                      <p className="text-sm text-muted-foreground">Total Cost</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
} 