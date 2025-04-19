declare module 'chart.js/auto' {
  export * from 'chart.js'
}

declare module 'react-chartjs-2' {
  import { ChartProps } from 'chart.js'
  import { FC } from 'react'

  export const Line: FC<ChartProps>
  export const Bar: FC<ChartProps>
  export const Pie: FC<ChartProps>
  export const Doughnut: FC<ChartProps>
  export const PolarArea: FC<ChartProps>
  export const Radar: FC<ChartProps>
  export const Scatter: FC<ChartProps>
  export const Bubble: FC<ChartProps>
} 