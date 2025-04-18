'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Zap, Snail } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import Chart from './Chart'

interface BlockLatency {
  type: string
  avgLatency: number
  p50Latency: number
  p75Latency: number
  p99Latency: number
  p100Latency: number
  samples: number
}

interface LatencyAnalysisProps {
  blockLatencies: BlockLatency[]
}

interface PercentileOption {
  value: keyof BlockLatency
  label: string
  color: {
    bg: string
    border: string
  }
}

const FAST_THRESHOLD = 1000 // 1 second

const PERCENTILE_OPTIONS: PercentileOption[] = [
  {
    value: 'p50Latency',
    label: '50th Percentile',
    color: {
      bg: 'rgba(34, 197, 94, 0.5)',
      border: 'rgba(34, 197, 94, 0.8)'
    }
  },
  {
    value: 'p75Latency',
    label: '75th Percentile',
    color: {
      bg: 'rgba(59, 130, 246, 0.5)',
      border: 'rgba(59, 130, 246, 0.8)'
    }
  },
  {
    value: 'p99Latency',
    label: '99th Percentile',
    color: {
      bg: 'rgba(147, 51, 234, 0.5)',
      border: 'rgba(147, 51, 234, 0.8)'
    }
  },
  {
    value: 'p100Latency',
    label: '100th Percentile',
    color: {
      bg: 'rgba(239, 68, 68, 0.5)',
      border: 'rgba(239, 68, 68, 0.8)'
    }
  }
]

export default function LatencyAnalysis({ blockLatencies }: LatencyAnalysisProps) {
  const [selectedPercentiles, setSelectedPercentiles] = useState<Set<string>>(new Set(['p99Latency']))
  
  // Sort blocks by average latency
  const sortedBlocks = [...blockLatencies].sort((a, b) => a.avgLatency - b.avgLatency)

  const togglePercentile = (value: string) => {
    const newSelected = new Set(selectedPercentiles)
    if (newSelected.has(value)) {
      newSelected.delete(value)
    } else {
      newSelected.add(value)
    }
    // Ensure at least one percentile is selected
    if (newSelected.size > 0) {
      setSelectedPercentiles(newSelected)
    }
  }

  const datasets = Array.from(selectedPercentiles).map(percentile => {
    const option = PERCENTILE_OPTIONS.find(opt => opt.value === percentile)
    return {
      label: option?.label || '',
      data: sortedBlocks.map(block => block[percentile as keyof BlockLatency] as number),
      backgroundColor: option?.color.bg || '',
      borderColor: option?.color.border || '',
      borderWidth: 1,
    }
  })

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Block Execution Speed</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-2">
              {sortedBlocks.map((block) => (
                <div
                  key={block.type}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    {block.avgLatency <= FAST_THRESHOLD ? (
                      <Zap className="h-4 w-4 text-green-500" />
                    ) : (
                      <Snail className="h-4 w-4 text-yellow-500" />
                    )}
                    <span className="font-medium">{block.type}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className="text-sm font-medium">
                      {block.avgLatency.toFixed(0)}ms avg
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {block.samples} samples
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Latency Percentiles</CardTitle>
          <div className="flex gap-4">
            {PERCENTILE_OPTIONS.map((option) => (
              <div key={option.value} className="flex items-center space-x-2">
                <Checkbox
                  id={option.value}
                  checked={selectedPercentiles.has(option.value)}
                  onCheckedChange={() => togglePercentile(option.value)}
                  style={{
                    backgroundColor: selectedPercentiles.has(option.value) ? option.color.bg : undefined,
                    borderColor: option.color.border
                  }}
                />
                <label
                  htmlFor={option.value}
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
                  {option.label}
                </label>
              </div>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <Chart
            type="bar"
            data={{
              labels: sortedBlocks.map(block => block.type),
              datasets
            }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  beginAtZero: true,
                  title: {
                    display: true,
                    text: 'Milliseconds'
                  }
                },
                x: {
                  ticks: {
                    maxRotation: 45,
                    minRotation: 45
                  }
                }
              }
            }}
            height={300}
          />
        </CardContent>
      </Card>
    </div>
  )
} 