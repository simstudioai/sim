import styles from '@/platform/design-system/catalog/plots.module.css'

interface TrendPlotProps {
  label: string
  values: readonly number[]
  maximum: number
}

export function TrendPlot({ label, values, maximum }: TrendPlotProps) {
  const points = values.map((value, index) => {
    const x = (480 * index) / Math.max(1, values.length - 1)
    const y = 144 - Math.max(0, Math.min(1, value / Math.max(1, maximum))) * 136
    return [x, y].join(' ')
  })
  const line = points.length ? `M${points.join(' L')}` : ''
  return (
    <svg
      className={styles.plot}
      role='img'
      aria-label={label}
      viewBox='0 0 480 152'
      preserveAspectRatio='none'
    >
      {line && (
        <>
          <path className={styles.area} d={`${line} L480 152 L0 152 Z`} />
          <path className={styles.line} d={line} vectorEffect='non-scaling-stroke' />
        </>
      )}
    </svg>
  )
}

interface StackPlotProps {
  label: string
  values: readonly (readonly [number, number])[]
  maximum: number
}

export function StackPlot({ label, values, maximum }: StackPlotProps) {
  const step = 480 / Math.max(1, values.length)
  const width = Math.min(32, step * 0.8)
  return (
    <svg
      className={styles.plot}
      role='img'
      aria-label={label}
      viewBox='0 0 480 136'
      preserveAspectRatio='none'
    >
      {values.map(([base, extra], index) => {
        const lower = Math.max(0, Math.min(136, (base * 136) / Math.max(1, maximum)))
        const total = Math.min(136, lower + Math.max(0, (extra * 136) / Math.max(1, maximum)))
        const x = (index + 0.5) * step - width / 2
        const y = 136 - total
        const radius = Math.min(4, total, width / 2)
        return (
          <g key={x}>
            <path
              className={styles.stackSecondary}
              d={`M${x} 136V${y + radius}Q${x} ${y} ${x + radius} ${y}H${x + width - radius}Q${x + width} ${y} ${x + width} ${y + radius}V136Z`}
            />
            <rect
              className={styles.stackPrimary}
              x={x}
              y={136 - lower}
              width={width}
              height={lower}
            />
          </g>
        )
      })}
    </svg>
  )
}

interface DonutPlotProps {
  label: string
  values: readonly number[]
}

export function DonutPlot({ label, values }: DonutPlotProps) {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0)
  const arcs = values.map((value) => (total ? (100 * Math.max(0, value)) / total : 0))
  let offset = 0
  return (
    <svg className={styles.plot} role='img' aria-label={label} viewBox='0 0 160 160'>
      {arcs.map((length, index) => {
        const start = offset
        offset += length
        const stroke = Math.max(0, length - 0.833)
        return (
          stroke > 0 && (
            <circle
              key={start}
              className={styles.arc}
              data-series={index % 4}
              cx='80'
              cy='80'
              r='60'
              fill='none'
              strokeWidth='16'
              pathLength='100'
              strokeDasharray={`${stroke} ${100 - stroke}`}
              strokeDashoffset={-start - 0.416}
              transform='rotate(-90 80 80)'
            />
          )
        )
      })}
    </svg>
  )
}
