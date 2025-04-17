'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Chart from '../components/Chart'
import BlockUsageChart from '../components/BlockUsageChart'
import { ChartData } from 'chart.js'

interface AnalyticsData {
  overview: {
    totalWorkflows: number
    activeWorkflows: number
    totalExecutions: number
    avgBlocksPerWorkflow: number
  }
  workflowTrends: {
    dates: string[]
    workflows: number[]
    executions: number[]
  }
  blockUsage: {
    blocks: string[]
    count: number[]
  }
}

export default function AnalyticsContent() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d'>('7d')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/admin/analytics?timeRange=${timeRange}`)
        if (!response.ok) throw new Error('Failed to fetch analytics data')
        const analyticsData = await response.json()
        setData(analyticsData)
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [timeRange])

  if (loading) return <div>Loading analytics...</div>
  if (error) return <div>Error: {error}</div>
  if (!data) return null

  const workflowTrendsData: ChartData<'line'> = {
    labels: data.workflowTrends.dates,
    datasets: [
      {
        label: 'New Workflows',
        data: data.workflowTrends.workflows,
        borderColor: 'rgb(53, 162, 235)',
        backgroundColor: 'rgba(53, 162, 235, 0.5)',
      },
      {
        label: 'Executions',
        data: data.workflowTrends.executions,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.5)',
      },
    ],
  }

  return (
    <div className="space-y-8">
      <Tabs defaultValue={timeRange} onValueChange={(v) => setTimeRange(v as '7d' | '30d')}>
        <TabsList>
          <TabsTrigger value="7d">Last 7 Days</TabsTrigger>
          <TabsTrigger value="30d">Last 30 Days</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4">
          <h3 className="text-sm font-medium">Total Workflows</h3>
          <p className="mt-2 text-2xl font-bold">{data.overview.totalWorkflows}</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-medium">Active Workflows</h3>
          <p className="mt-2 text-2xl font-bold">{data.overview.activeWorkflows}</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-medium">Total Executions</h3>
          <p className="mt-2 text-2xl font-bold">{data.overview.totalExecutions}</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-medium">Avg. Blocks per Workflow</h3>
          <p className="mt-2 text-2xl font-bold">{data.overview.avgBlocksPerWorkflow.toFixed(1)}</p>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Chart
          type="line"
          data={workflowTrendsData}
          options={{
            plugins: {
              title: {
                display: true,
                text: 'Workflow & Execution Trends',
              },
            },
          }}
        />
        <BlockUsageChart
          blocks={data.blockUsage.blocks}
          count={data.blockUsage.count}
        />
      </div>
    </div>
  )
} 