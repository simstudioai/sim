'use client'

import { useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Button } from '@/platform/design-system/components/button/button'
import { ActionMenuPopup, MenuItem } from '@/platform/design-system/components/menu/action-menu'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'

interface MenuChoice<Value extends string> {
  value: Value
  label: string
  disabled?: boolean
}

interface ChoiceMenuProps<Value extends string> {
  label: string
  options: readonly MenuChoice<Value>[]
  value?: Value | null
  placeholder?: string
  defaultValue?: Value
  defaultOpen?: boolean
  onValueChange?: (value: Value) => void
}

export function ChoiceMenu<Value extends string>({
  label,
  options,
  value: controlledValue,
  placeholder,
  defaultValue,
  defaultOpen = false,
  onValueChange,
}: ChoiceMenuProps<Value>) {
  const [localValue, setLocalValue] = useState(defaultValue)
  const selection = controlledValue === undefined ? localValue : controlledValue
  const selected =
    options.find((option) => option.value === selection) ??
    (selection === null ? undefined : options[0])
  const caption = selected?.label ?? placeholder ?? label
  const { trigger, container } = usePopoverContainer()
  return (
    <Menu.Root modal={false} defaultOpen={defaultOpen && options.length > 0}>
      <Button
        render={<Menu.Trigger ref={trigger} aria-label={`${label}: ${caption}`} />}
        disabled={!options.length}
        variant='quiet'
        size='compact'
      >
        {caption}
      </Button>
      <ActionMenuPopup label={label} container={container} align='end'>
        <Menu.RadioGroup
          value={selected?.value ?? ''}
          onValueChange={(next: string) => {
            const option = options.find((item) => item.value === next && !item.disabled)
            if (!option) return
            if (controlledValue === undefined) setLocalValue(option.value)
            onValueChange?.(option.value)
          }}
        >
          {options.map((option) => (
            <MenuItem
              key={option.value}
              label={option.label}
              value={option.value}
              disabled={option.disabled}
            />
          ))}
        </Menu.RadioGroup>
      </ActionMenuPopup>
    </Menu.Root>
  )
}
