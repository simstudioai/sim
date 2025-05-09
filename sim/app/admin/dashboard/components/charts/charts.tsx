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

// Deep merge function to handle nested properties
function deepMerge<T extends Record<string, any>>(target: T, source: Partial<T>): T {
  const output = { ...target }
  
  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      const sourceValue = source[key as keyof typeof source]
      const targetValue = target[key as keyof typeof target]
      
      if (isObject(sourceValue)) {
        if (!(key in target)) {
          Object.assign(output, { [key]: sourceValue })
        } else if (isObject(targetValue)) {
          // Ensure both values are objects before recursive merge
          const mergedValue = deepMerge(
            targetValue as Record<string, any>,
            sourceValue as Record<string, any>
          )
          output[key as keyof T] = mergedValue as T[keyof T]
        }
      } else {
        Object.assign(output, { [key]: sourceValue })
      }
    })
  }
  
  return output as T
}

// Helper function to check if value is an object
function isObject(item: unknown): item is Record<string, any> {
  return Boolean(item && typeof item === 'object' && !Array.isArray(item))
}

export default function Chart({
  type,
  data,
  options = {},
  className = '',
  height = 300,
}: ChartProps) {
  const baseOptions = type === 'doughnut' ? doughnutOptions : defaultOptions
  const mergedOptions = deepMerge(baseOptions, options)

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