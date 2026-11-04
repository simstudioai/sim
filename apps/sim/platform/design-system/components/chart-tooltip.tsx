import { chartNumber } from '@/platform/design-system/components/chart-format'
import styles from '@/platform/design-system/components/chart-tooltip.module.css'

interface ChartTooltipProps {
  id?: string
  heading: string
  entries: readonly { label: string; value: string | number }[]
}

export function ChartTooltip({ id, heading, entries }: ChartTooltipProps) {
  return (
    <div id={id} role='tooltip' className={styles.tooltip}>
      <span data-type='T052'>{heading}</span>
      {entries.map((entry) => (
        <div key={entry.label} className={styles.detail}>
          <span data-type='T052'>{entry.label}</span>
          <span data-type='T051'>
            {typeof entry.value === 'number' ? chartNumber.format(entry.value) : entry.value}
          </span>
        </div>
      ))}
    </div>
  )
}
