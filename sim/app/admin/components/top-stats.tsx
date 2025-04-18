import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import BlockUsageChart from './BlockUsageChart'

interface TopStatsProps {
  topUsers: Array<{
    name: string
    email: string
    workflowCount: number
    blockCount: number
  }>
  topBlocks: Array<{
    type: string
    count: number
  }>
  onUserClick: (email: string) => void
}

export function TopStats({ topUsers, topBlocks, onUserClick }: TopStatsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
      <Card className="col-span-4">
        <CardHeader>
          <CardTitle>Top Users</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-4">
              {topUsers.map((user, i) => (
                <div 
                  key={i} 
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-accent cursor-pointer transition-colors"
                  onClick={() => onUserClick(user.email)}
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
            {topBlocks && topBlocks.length > 0 ? (
              <BlockUsageChart
                blocks={topBlocks.map(block => block.type)}
                count={topBlocks.map(block => block.count)}
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
  )
} 