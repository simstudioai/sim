import { memo, useId } from 'react'
import { area, curveLinear, curveMonotoneX, line } from 'd3-shape'
import styles from '#emcn/catalog/plots.module.css'

interface TrendPlotProps {
  label: string
  values: readonly number[]
  maximum: number
  straight?: boolean
  active?: number
}

export function TrendPlot({ label, values, maximum, active, straight }: TrendPlotProps) {
  const gradient = useId()
  const x = (_value: number, index: number) =>
    values.length === 1 ? 240 : (480 * index) / (values.length - 1)
  const y = (value: number) => 144 - Math.max(0, Math.min(1, value / maximum)) * 136
  const curve = straight ? curveLinear : curveMonotoneX
  const stroke = line<number>().x(x).y(y).curve(curve)(values)
  const fill = area<number>().x(x).y0(152).y1(y).curve(curve)(values)
  const point =
    active !== undefined && values[active] !== undefined
      ? active
      : values.length === 1
        ? 0
        : undefined
  return (
    <svg className={styles.trend} role='img' aria-label={label}>
      <svg
        width='100%'
        height='100%'
        viewBox='0 0 480 152'
        preserveAspectRatio='none'
        aria-hidden='true'
      >
        <defs>
          <linearGradient
            id={gradient}
            x1='0'
            y1='0'
            x2='0'
            y2='1'
            gradientUnits='objectBoundingBox'
          >
            <stop className={styles.area} offset='0%' />
            <stop className={styles.area} offset='100%' stopOpacity='0' />
          </linearGradient>
        </defs>
        {values.length > 1 && fill && <path fill={`url(#${gradient})`} d={fill} />}
        {stroke && <path className={styles.line} d={stroke} vectorEffect='non-scaling-stroke' />}
        {active !== undefined && values[active] !== undefined && (
          <line
            className={styles.guide}
            x1={x(0, active)}
            x2={x(0, active)}
            y1='0'
            y2='152'
            vectorEffect='non-scaling-stroke'
          />
        )}
      </svg>
      {point !== undefined && (
        <circle
          data-plot-marker=''
          className={styles.point}
          cx={`${(x(0, point) / 480) * 100}%`}
          cy={`${(y(values[point]) / 152) * 100}%`}
        />
      )}
    </svg>
  )
}

interface StackPlotProps {
  label: string
  /** Each column's layers, bottom-up. */
  values: readonly (readonly number[])[]
  maximum: number
  highlighted?: number
}

export const StackPlot = memo(function StackPlot({
  label,
  values,
  maximum,
  highlighted,
}: StackPlotProps) {
  return (
    <div className={styles.columns} role='img' aria-label={label}>
      {values.map((layers, index) => {
        let height = 0
        const tops = layers.map((value) => {
          height = Math.min(136, height + Math.max(0, (136 * value) / maximum))
          return height
        })
        const total = tops.at(-1) ?? 0
        const topLayer = layers.reduce((top, value, layer) => (value > 0 ? layer : top), 0)
        const y = 136 - total
        const radius = Math.min(4, total)
        const outline = `M0 136V${y + radius}Q0 ${y} ${radius} ${y}H${32 - radius}Q32 ${y} 32 ${y + radius}V136Z`
        return (
          <div className={styles.column} key={index}>
            <svg
              className={styles.bar}
              aria-hidden='true'
              viewBox='0 0 32 136'
              preserveAspectRatio='none'
            >
              <path
                className={styles.stackLayer}
                data-layer={topLayer}
                data-dimmed={(highlighted !== undefined && topLayer !== highlighted) || undefined}
                d={outline}
              />
              {tops
                .slice(0, topLayer)
                .map((top, layer) => ({ top, layer }))
                .reverse()
                .map(({ top, layer }) => (
                  <rect
                    key={layer}
                    className={styles.stackLayer}
                    data-layer={layer}
                    data-dimmed={(highlighted !== undefined && layer !== highlighted) || undefined}
                    x='0'
                    y={136 - top}
                    width='32'
                    height={top}
                  />
                ))}
            </svg>
          </div>
        )
      })}
    </div>
  )
})

interface DonutPlotProps {
  label: string
  values: readonly number[]
  onInspect?: (index: number | null) => void
}

export function DonutPlot({ label, values, onInspect }: DonutPlotProps) {
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
              onPointerEnter={onInspect && (() => onInspect(index))}
              onPointerLeave={onInspect && (() => onInspect(null))}
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
