import { format } from 'date-fns'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import BlockUsageChart from '@/app/admin/components/BlockUsageChart'

interface Block {
  type: string
  count: number
}

interface Workflow {
  id: string
  name: string
  created_at: string
  blocks: { type: string }[]
}

interface UserStatsCardProps {
  firstName: string
  workflows: Workflow[]
  blockUsage: Block[]
  totalBlocks: number
  avgBlocksPerWorkflow: number
  totalCost: number
}

export function UserStatsCard({
  firstName,
  workflows,
  blockUsage,
  totalBlocks,
  avgBlocksPerWorkflow,
  totalCost,
}: UserStatsCardProps) {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{firstName}'s Statistics</h2>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Most Used Blocks</CardTitle>
        </CardHeader>
        <CardContent>
          {blockUsage.length > 0 ? (
            <BlockUsageChart
              blocks={blockUsage.map(block => block.type)}
              count={blockUsage.map(block => block.count)}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              No block usage data available
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workflows ({workflows.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {workflows.map(workflow => (
              <div
                key={workflow.id}
                className="flex items-center justify-between border-b pb-2 last:border-0"
              >
                <div>
                  <p className="font-medium">{workflow.name}</p>
                  <p className="text-sm text-muted-foreground">
                    Created: {format(new Date(workflow.created_at), 'PP')}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-medium">{workflow.blocks.length} blocks</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Block Statistics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <p className="text-2xl font-bold">{totalBlocks}</p>
                <p className="text-sm text-muted-foreground">Total Blocks Used</p>
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {avgBlocksPerWorkflow.toFixed(1)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Average Blocks per Workflow
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cost</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div>
                <p className="text-2xl font-bold">${(totalCost || 0).toFixed(4)} USD</p>
                <p className="text-sm text-muted-foreground">Total Cost</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
} 