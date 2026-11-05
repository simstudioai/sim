'use client'

import { useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { ActionMenuPopup, MenuItem } from '@/platform/design-system/components/menu/action-menu'
import styles from '@/platform/design-system/components/menu/range-picker.module.css'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'
import { Tooltip } from '@/platform/design-system/components/tooltip/tooltip'

interface RangePickerProps {
  label: string
  options: readonly string[]
  defaultValue?: string
  defaultOpen?: boolean
  onValueChange?: (value: string) => void
}

export function RangePicker({
  label,
  options,
  defaultValue,
  defaultOpen = false,
  onValueChange,
}: RangePickerProps) {
  const [selection, setSelection] = useState(defaultValue)
  const value = selection !== undefined && options.includes(selection) ? selection : options[0]
  const { trigger, container } = usePopoverContainer()
  return (
    <Menu.Root modal={false} defaultOpen={defaultOpen && options.length > 0}>
      <Tooltip label={label}>
        <Menu.Trigger
          ref={trigger}
          className={styles.trigger}
          aria-label={value ? `${label}: ${value}` : label}
          disabled={!options.length}
          data-type='T060'
        >
          {value || label}
          <Icon name='I080' />
        </Menu.Trigger>
      </Tooltip>
      <ActionMenuPopup label={label} container={container} align='end'>
        <Menu.RadioGroup
          value={value}
          onValueChange={(next: string) => {
            setSelection(next)
            onValueChange?.(next)
          }}
        >
          {options.map((option) => (
            <MenuItem key={option} label={option} value={option} />
          ))}
        </Menu.RadioGroup>
      </ActionMenuPopup>
    </Menu.Root>
  )
}
