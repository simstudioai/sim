'use client'

import { useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Button } from '@/platform/design-system/components/button/button'
import { ActionMenuPopup, MenuItem } from '@/platform/design-system/components/menu/action-menu'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'

interface RangePickerProps {
  id?: string
  label: string
  options: readonly string[]
  value?: string
  defaultValue?: string
  defaultOpen?: boolean
  onValueChange?: (value: string) => void
}

export function RangePicker({
  id,
  label,
  options,
  value: controlledValue,
  defaultValue,
  defaultOpen = false,
  onValueChange,
}: RangePickerProps) {
  const [localValue, setLocalValue] = useState(defaultValue)
  const selection = controlledValue ?? localValue
  const value = selection !== undefined && options.includes(selection) ? selection : options[0]
  const { trigger, container } = usePopoverContainer()
  return (
    <Menu.Root modal={false} defaultOpen={defaultOpen && options.length > 0}>
      <Button
        render={
          <Menu.Trigger id={id} ref={trigger} aria-label={value ? `${label}: ${value}` : label} />
        }
        disabled={!options.length}
        variant='quiet'
        size='compact'
      >
        {value || label}
      </Button>
      <ActionMenuPopup label={label} container={container} align='end'>
        <Menu.RadioGroup
          value={value}
          onValueChange={(next: string) => {
            if (controlledValue === undefined) setLocalValue(next)
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
