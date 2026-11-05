import { HomeActivityChart } from '@/platform/app/(shell)/home/_components/activity-chart/activity-chart'
import { ChartTooltip } from '@/platform/design-system/components'
import type { PreviewData } from '@/platform/fixtures'
import { formatCalendarDate } from '@/platform/lib/time'

interface HomeChartSpecimenProps {
  recipe: string
  data: PreviewData | null
}

export function HomeChartSpecimen({ recipe, data }: HomeChartSpecimenProps) {
  const points = data?.charts.trend ?? []
  if (recipe === 'C0176' || recipe === 'C0177') {
    const point = points[0]
    return point ? (
      <ChartTooltip
        heading={formatCalendarDate(point.date, 'full')}
        entries={[{ label: 'Tasks run', value: point.value }]}
      />
    ) : null
  }
  return (
    <HomeActivityChart
      title='Tasks run'
      points={recipe === 'C0165' ? [] : data?.charts.trend}
      initialPoint={
        recipe === 'C0169' ? Math.floor((Math.min(points.length, 7) - 1) / 2) : undefined
      }
      initiallyOpen={recipe === 'C0175'}
    />
  )
}
