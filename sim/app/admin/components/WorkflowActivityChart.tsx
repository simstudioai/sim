'use client'

import { useState, useEffect } from 'react'
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

type TimeRange = '1h' | '24h' | '7d'

export default function WorkflowActivityChart({ executions }: WorkflowActivityChartProps) {
  const [timeRange, setTimeRange] = useState<TimeRange>('1h')

  // Debug log
  useEffect(() => {
    console.log('WorkflowActivityChart executions:', executions)
  }, [executions])

  const getTimeRangeData = () => {
    const now = new Date()
    const cutoff = timeRange === '1h' 
      ? subHours(now, 1)
      : timeRange === '24h'
        ? subHours(now, 24)
        : subDays(now, 7)

    // Debug log
    console.log('Time range:', timeRange, 'Cutoff:', cutoff)

    // Filter executions within the time range
    const filteredExecutions = executions.filter(exec => {
      const execDate = new Date(exec.created_at)
      const isInRange = execDate >= cutoff
      return isInRange
    })

    // Debug log
    console.log('Filtered executions:', filteredExecutions)

    // Group executions by time interval
    const intervals = timeRange === '1h' ? 12 : timeRange === '24h' ? 24 : 7
    const intervalSize = timeRange === '1h' ? 5 : timeRange === '24h' ? 60 : 1440 // minutes

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

    // Debug log
    console.log('Time slots:', timeSlots)

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
  }

  const chartData = getTimeRangeData()

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-medium">Workflow Activity</CardTitle>
        <Tabs value={timeRange} onValueChange={(value) => setTimeRange(value as TimeRange)}>
          <TabsList className="grid w-full grid-cols-3 lg:w-[200px]">
            <TabsTrigger value="1h">1h</TabsTrigger>
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
            options={{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  position: 'top',
                  align: 'end',
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
            }}
            height={300}
          />
        )}
      </CardContent>
    </Card>
  )
} 