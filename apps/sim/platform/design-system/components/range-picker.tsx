'use client'

import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ActionMenu, MenuItem } from '@/platform/design-system/components/action-menu'
import { Icon } from '@/platform/design-system/components/icon'
import styles from '@/platform/design-system/components/range-picker.module.css'

interface RangePickerProps {
  label: string
  options: readonly string[]
  defaultValue?: string
  size?: 'regular' | 'compact'
  onValueChange?: (value: string) => void
}

export function RangePicker({
  label,
  options,
  defaultValue,
  size = 'regular',
  onValueChange,
}: RangePickerProps) {
  const [value, setValue] = useState(defaultValue ?? options[0])
  const [open, setOpen] = useState(false)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type='button'
          className={styles.trigger}
          aria-label={value ? `${label}: ${value}` : label}
          disabled={!options.length}
          data-size={size}
          data-type='T060'
        >
          {value || label}
          <Icon name='I080' />
        </button>
      </Popover.Trigger>
      <Popover.Content
        align='end'
        sideOffset={4}
        asChild
        onOpenAutoFocus={(event) => {
          const first =
            event.currentTarget instanceof HTMLElement &&
            event.currentTarget.querySelector<HTMLElement>('[aria-checked="true"]')
          if (first) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <div>
          <ActionMenu label={label} defaultValue={value}>
            {options.map((option) => (
              <MenuItem
                key={option}
                label={option}
                value={option}
                selected={option === value}
                onSelect={() => {
                  setValue(option)
                  setOpen(false)
                  onValueChange?.(option)
                }}
              />
            ))}
          </ActionMenu>
        </div>
      </Popover.Content>
    </Popover.Root>
  )
}
