import { ChartTooltip, TasksRunChart } from '@/platform/design-system/components'
import type { PreviewData } from '@/platform/fixtures'

interface HomeChartSpecimenProps {
  recipe: string
  data: PreviewData | null
}

export function HomeChartSpecimen({ recipe, data }: HomeChartSpecimenProps) {
  const points = data?.charts.trend ?? []
  if (recipe === 'C0176' || recipe === 'C0177') {
    const point = points[0]
    return point ? (
      <ChartTooltip heading={point.label} entries={[{ label: 'Tasks run', value: point.value }]} />
    ) : null
  }
  const ranges = [7, 30, 90].map((days) => ({
    label: `Last ${days} days`,
    points: recipe === 'C0165' ? [] : points.slice(-days),
  }))
  return (
    <TasksRunChart
      title='Tasks run'
      ranges={ranges}
      inset={recipe === 'C0160' || recipe === 'C0162' ? 'flush' : 'padded'}
      initialPoint={
        recipe === 'C0169' ? Math.floor((Math.min(points.length, 7) - 1) / 2) : undefined
      }
      initiallyOpen={recipe === 'C0175'}
    />
  )
}
