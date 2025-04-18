'use client'

import { useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { format, subHours, subDays } from 'date-fns'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Chart from './Chart'

interface WorkflowExecution {
  workflow_id: string
  created_at: string
  status: string
}

interface WorkflowActivityChartProps {
  executions: WorkflowExecution[]
}

type TimeRange = '1h' | '6h' | '12h' | '24h' | '7d'

export default function WorkflowActivityChart({ executions }: WorkflowActivityChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h')

  // Memoize the getTimeRangeData function
  const getTimeRangeData = useCallback(() => {
    const now = new Date()
    
    // Calculate cutoff time based on selected time range
    let cutoff: Date
    switch (timeRange) {
      case '1h':
        cutoff = subHours(now, 1)
        break
      case '6h':
        cutoff = subHours(now, 6)
        break
      case '12h':
        cutoff = subHours(now, 12)
        break
      case '24h':
        cutoff = subHours(now, 24)
        break
      case '7d':
        cutoff = subDays(now, 7)
        break
      default:
        cutoff = subHours(now, 1) // Default to 1h if somehow timeRange is invalid
    }

    // Filter executions within the time range
    const filteredExecutions = executions.filter(exec => {
      const execDate = new Date(exec.created_at)
      const isInRange = execDate >= cutoff
      return isInRange
    })

    // Get interval configuration based on time range
    let intervals: number
    let intervalSize: number
    switch (timeRange) {
      case '1h':
        intervals = 12 // 5 min intervals
        intervalSize = 5
        break
      case '6h':
        intervals = 12 // 30 min intervals
        intervalSize = 30
        break
      case '12h':
        intervals = 12 // 1 hour intervals
        intervalSize = 60
        break
      case '24h':
        intervals = 24 // 1 hour intervals
        intervalSize = 60
        break
      case '7d':
        intervals = 7 // 1 day intervals
        intervalSize = 1440
        break
      default:
        intervals = 12
        intervalSize = 5
    }

    const timeSlots = Array.from({ length: intervals }, (_, i) => {
      const slotTime = timeRange === '7d'
        ? subDays(now, intervals - 1 - i)
        : subHours(now, (intervals - 1 - i) * (intervalSize / 60))
      
      return {
        time: slotTime,
        count: 0,
        successful: 0,
        failed: 0
      }
    })

    // Count executions in each time slot
    filteredExecutions.forEach(exec => {
      const execTime = new Date(exec.created_at)
      const slotIndex = timeSlots.findIndex((slot, index) => {
        const nextSlot = timeSlots[index + 1]
        return execTime >= slot.time && (!nextSlot || execTime < nextSlot.time)
      })

      if (slotIndex !== -1) {
        timeSlots[slotIndex].count++
        if (exec.status === 'success') {
          timeSlots[slotIndex].successful++
        } else if (exec.status === 'error') {
          timeSlots[slotIndex].failed++
        }
      }
    })

    return {
      labels: timeSlots.map(slot => 
        timeRange === '7d'
          ? format(slot.time, 'MMM d')
          : format(slot.time, 'HH:mm')
      ),
      datasets: [
        {
          label: 'Successful',
          data: timeSlots.map(slot => slot.successful),
          borderColor: 'rgba(34, 197, 94, 0.8)',
          backgroundColor: 'rgba(34, 197, 94, 0.2)',
          fill: true,
          tension: 0.4,
        },
        {
          label: 'Failed',
          data: timeSlots.map(slot => slot.failed),
          borderColor: 'rgba(239, 68, 68, 0.8)',
          backgroundColor: 'rgba(239, 68, 68, 0.2)',
          fill: true,
          tension: 0.4,
        }
      ]
    }
  }, [timeRange, executions]) // Only recreate when timeRange or executions change

  // Memoize the chart data
  const chartData = useMemo(() => getTimeRangeData(), [getTimeRangeData])

  // Memoize chart options
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        align: 'end' as const,
      },
    },
    scales: {
      x: {
        grid: {
          display: false,
        },
      },
      y: {
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          stepSize: 1,
        },
      },
    },
  }), []) // Empty dependency array since options don't depend on any props or state

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Workflow Activity</CardTitle>
        <Tabs value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
          <TabsList className="grid w-full grid-cols-5 lg:w-[300px]">
            <TabsTrigger value="1h">1h</TabsTrigger>
            <TabsTrigger value="6h">6h</TabsTrigger>
            <TabsTrigger value="12h">12h</TabsTrigger>
            <TabsTrigger value="24h">24h</TabsTrigger>
            <TabsTrigger value="7d">7d</TabsTrigger>
          </TabsList>
        </Tabs>
      </CardHeader>
      <CardContent>
        {executions.length === 0 ? (
          <div className="flex items-center justify-center h-[300px] text-sm text-muted-foreground">
            No workflow executions found
          </div>
        ) : (
          <Chart
            type="line"
            data={chartData}
            options={chartOptions}
            height={300}
          />
        )}
      </CardContent>
    </Card>
  )
} 