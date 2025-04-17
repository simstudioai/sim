'use client'

import { Card } from '@/components/ui/card'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ChartData,
  ChartOptions,
} from 'chart.js'
import { Line, Bar } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Title,
  Tooltip,
  Legend
)

interface ChartProps {
  type: 'line' | 'bar'
  data: ChartData<'line' | 'bar'>
  options?: ChartOptions<'line' | 'bar'>
  className?: string
  height?: number
}

const defaultOptions: ChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'top' as const,
      align: 'end' as const,
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      grid: {
        color: 'rgba(0, 0, 0, 0.1)',
      },
    },
    x: {
      grid: {
        display: false,
      },
    },
  },
}

export default function Chart({
  type,
  data,
  options = {},
  className = '',
  height = 300,
}: ChartProps) {
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    plugins: {
      ...defaultOptions.plugins,
      ...options.plugins,
    },
  }

  return (
    <Card className={`p-4 ${className}`}>
      <div style={{ height }}>
        {type === 'line' ? (
          <Line data={data} options={mergedOptions} />
        ) : (
          <Bar data={data} options={mergedOptions} />
        )}
      </div>
    </Card>
  )
} 