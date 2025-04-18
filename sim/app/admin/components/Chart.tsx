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
  ArcElement,
} from 'chart.js'
import { Line, Bar, Doughnut } from 'react-chartjs-2'

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
)

interface ChartProps {
  type: 'line' | 'bar' | 'doughnut'
  data: ChartData<'line' | 'bar' | 'doughnut'>
  options?: ChartOptions<'line' | 'bar' | 'doughnut'>
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

const doughnutOptions: ChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'bottom' as const,
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
    ...(type === 'doughnut' ? doughnutOptions : defaultOptions),
    ...options,
    plugins: {
      ...(type === 'doughnut' ? doughnutOptions.plugins : defaultOptions.plugins),
      ...options.plugins,
    },
  }

  return (
    <Card className={`p-4 ${className}`}>
      <div style={{ height }}>
        {type === 'line' ? (
          <Line data={data} options={mergedOptions} />
        ) : type === 'bar' ? (
          <Bar data={data} options={mergedOptions} />
        ) : (
          <Doughnut data={data} options={mergedOptions} />
        )}
      </div>
    </Card>
  )
} 