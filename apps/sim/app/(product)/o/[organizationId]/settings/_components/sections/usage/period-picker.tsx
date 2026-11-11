'use client'

import { type ComponentProps, useRef, useState } from 'react'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { DateRangePicker } from '@sim/emcn/picker/date-picker'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/usage/usage-section.module.css'

interface PeriodPickerProps {
  options: ComponentProps<typeof ChoiceMenu>['options']
  /** The URL's period. */
  value: string
  /** The option that opens the custom range instead of choosing a preset. */
  customValue: string
  /** The applied custom range, when the period is custom. */
  range: { start: string; end: string } | null
  withTime?: boolean
  onPreset: (value: string) => void
  /** Return false to keep the range open after a rejected range. */
  onRange: ((start: string, end: string) => boolean) | ((start: string, end: string) => void)
}

/**
 * A period menu with its custom range. Choosing Custom range opens the range picker in place; closing
 * it without a range returns to the preset still in force, with focus back on the menu.
 */
export function PeriodPicker({
  options,
  value,
  customValue,
  range,
  withTime,
  onPreset,
  onRange,
}: PeriodPickerProps) {
  const [choosingRange, setChoosingRange] = useState(false)
  const menu = useRef<HTMLSpanElement>(null)
  const custom = value === customValue
  return (
    <>
      <span ref={menu} className={styles.periodMenu}>
        <ChoiceMenu
          label='Period'
          options={options}
          value={choosingRange ? customValue : value}
          onValueChange={(next) => {
            if (next === customValue) setChoosingRange(true)
            else onPreset(next)
          }}
        />
      </span>
      {(choosingRange || custom) && (
        <DateRangePicker
          label='Custom range'
          labelHidden
          withTime={withTime}
          open={choosingRange}
          onOpenChange={(open) => {
            setChoosingRange(open)
            // The range trigger leaves with the draft, so focus returns to the menu that opened it.
            if (!open && !custom) menu.current?.querySelector('button')?.focus()
          }}
          value={range}
          onValueChange={(next) => (next ? onRange(next.start, next.end) : undefined)}
        />
      )}
    </>
  )
}
