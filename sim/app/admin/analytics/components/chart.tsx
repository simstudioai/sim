'use client'

import { Line, Bar } from 'react-chartjs-2'
import 'chart.js/auto'
import { Card } from '@/components/ui/card'

interface AnalyticsChartData {
  labels: string[]
  datasets: {
    label: string
    data: number[]
    borderColor?: string
    backgroundColor?: string
  }[]
}

interface ChartProps {
  title: string
  data: AnalyticsChartData
  type: 'line' | 'bar'
}

export function Chart({ title, data, type }: ChartProps) {
  const options = {
    responsive: true,
    plugins: {
      legend: {
        position: 'top' as const,
      },
      title: {
        display: true,
        text: title,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  }

  return (
    <Card className="p-4">
      {type === 'line' ? (
        <Line data={data} options={options} />
      ) : (
        <Bar data={data} options={options} />
      )}
    </Card>
  )
} 