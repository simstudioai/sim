'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Chart from '../charts/charts'

interface UserStatsCardProps {
  firstName: string
  workflows: any[]
  blockUsage: any[]
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
  totalCost
}: UserStatsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>User Statistics: {firstName}</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="workflows">Workflows</TabsTrigger>
            <TabsTrigger value="blocks">Blocks</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Workflows</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{workflows.length}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Blocks</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{totalBlocks}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Avg Blocks/Workflow</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{avgBlocksPerWorkflow.toFixed(1)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Total Cost</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">${totalCost.toFixed(2)}</div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
          <TabsContent value="workflows">
            <Chart
              type="bar"
              data={{
                labels: workflows.map(w => w.name || w.id),
                datasets: [
                  {
                    label: 'Blocks per Workflow',
                    data: workflows.map(w => w.blockCount || 0),
                    backgroundColor: 'rgba(59, 130, 246, 0.5)',
                  }
                ]
              }}
              options={{
                plugins: {
                  title: {
                    display: true,
                    text: 'Blocks per Workflow'
                  }
                }
              }}
            />
          </TabsContent>
          <TabsContent value="blocks">
            <Chart
              type="doughnut"
              data={{
                labels: blockUsage.map(b => b.type),
                datasets: [
                  {
                    data: blockUsage.map(b => b.count),
                    backgroundColor: [
                      'rgba(255, 99, 132, 0.5)',
                      'rgba(54, 162, 235, 0.5)',
                      'rgba(255, 206, 86, 0.5)',
                      'rgba(75, 192, 192, 0.5)',
                      'rgba(153, 102, 255, 0.5)',
                    ],
                  }
                ]
              }}
              options={{
                plugins: {
                  title: {
                    display: true,
                    text: 'Block Usage Distribution'
                  }
                }
              }}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  )
} 