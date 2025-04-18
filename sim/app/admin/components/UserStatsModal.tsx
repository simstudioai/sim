'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Terminal, Webhook, Clock, Globe, Box } from 'lucide-react'
import BlockUsageChart from './BlockUsageChart'
import WorkflowList from './WorkflowList'
import { Workflow } from '@/app/api/admin/dashboard/types'
import { useState, useEffect } from 'react'

// Extended workflow interface to support both formats returned by the API
interface ExtendedWorkflow extends Workflow {
  blockTypes?: string[]
}

interface UserStats {
  firstName: string
  email: string
  workflowCount: number
  blockCount: number
  workflows: ExtendedWorkflow[]
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
  const [error, setError] = useState<string | null>(null)
  const [fullStats, setFullStats] = useState<UserStats | null>(null)

  useEffect(() => {
    let isMounted = true;
    
    const fetchFullStats = async () => {
      try {
        // Simulate API call or data processing
        // In a real implementation, you might fetch additional data here
        if (isMounted) {
          setFullStats(stats);
        }
      } catch (err) {
        if (isMounted) {
          // Safely handle error without exposing the full error object
          setError(err instanceof Error ? err.message : 'An error occurred while loading user statistics');
        }
      }
    };

    fetchFullStats();
    
    // Cleanup function to prevent memory leaks
    return () => {
      isMounted = false;
    };
  }, [stats]);

  // Process workflows to ensure they have the expected structure
  const processedWorkflows = stats.workflows.map(workflow => {
    // If workflow has blockTypes but not blocks, create a compatible object
    if (workflow.blockTypes && !workflow.blocks) {
      return {
        ...workflow,
        // Convert blockTypes to blocks format for compatibility
        blockCount: workflow.blockTypes.length
      };
    }
    return workflow;
  });

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">{stats.firstName}'s Statistics</DialogTitle>
        </DialogHeader>

        {error && (
          <div className="bg-destructive/10 text-destructive p-3 rounded-md mb-4">
            {error}
          </div>
        )}

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
              {stats.blockUsage && stats.blockUsage.length > 0 ? (
                <BlockUsageChart
                  blocks={stats.blockUsage.map(b => b.type)}
                  count={stats.blockUsage.map(b => b.count)}
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
                Workflows ({stats.workflows.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WorkflowList
                workflows={processedWorkflows}
                loading={false}
              />
            </CardContent>
          </Card>

          {/* Block Stats */}
          <Card>
            <CardHeader>
              <CardTitle>Block Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <p className="text-2xl font-bold">{stats.totalBlocks}</p>
                  <p className="text-sm text-muted-foreground">Total Blocks Used</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {stats.avgBlocksPerWorkflow != null 
                      ? stats.avgBlocksPerWorkflow.toFixed(1) 
                      : '0.0'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Average Blocks per Workflow
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cost Statistics */}
          <Card>
            <CardHeader>
              <CardTitle>Cost Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div>
                  <p className="text-2xl font-bold">
                    ${stats.totalCost != null ? stats.totalCost.toFixed(2) : '0.00'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Total Cost
                  </p>
                </div>
                {stats.workflowCount > 0 && (
                  <div>
                    <p className="text-2xl font-bold">
                      ${stats.totalCost != null && stats.workflowCount > 0 
                        ? (stats.totalCost / stats.workflowCount).toFixed(2) 
                        : '0.00'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Average Cost per Workflow
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  )
} 