'use client'

import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/slider-input/slider-input.module.css'

interface RangeRowProps {
  /** Names the slider for assistive technology. */
  label: string
  min: number
  max: number
  value: number
  integer: boolean
  /** The step between fractional values; whole numbers always step by one. */
  step?: number
  disabled?: boolean
  onValueChange: (value: number) => void
}

/**
 * A bounded number on a native range track with its value read out beside it, for the slider field
 * and an MCP tool's numeric arguments. The shared library has no slider, so the track is native.
 */
export function RangeRow({
  label,
  min,
  max,
  value,
  integer,
  step = 0.1,
  disabled,
  onValueChange,
}: RangeRowProps) {
  return (
    <div className={styles.row} data-disabled={disabled || undefined}>
      <input
        type='range'
        className={styles.range}
        aria-label={label}
        min={min}
        max={max}
        step={integer ? 1 : step}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          if (disabled) return
          const next = Number(event.target.value)
          onValueChange(integer ? Math.round(next) : next)
        }}
      />
      <output className={styles.value} data-type='T060' aria-hidden='true'>
        {integer ? Math.round(value).toString() : value.toFixed(1)}
      </output>
    </div>
  )
}
