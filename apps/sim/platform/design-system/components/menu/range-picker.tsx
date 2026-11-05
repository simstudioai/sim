'use client'

import { useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Button } from '@/platform/design-system/components/button/button'
import { ActionMenuPopup, MenuItem } from '@/platform/design-system/components/menu/action-menu'
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
        <Button
          render={<Menu.Trigger ref={trigger} aria-label={value ? `${label}: ${value}` : label} />}
          disabled={!options.length}
          variant='quiet'
          size='compact'
          trailingIcon='I080'
        >
          {value || label}
        </Button>
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
