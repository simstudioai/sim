'use client'

import { useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Button } from '@/platform/design-system/components/button/button'
import {
  ActionMenuPopup,
  MenuItem,
  SubmenuItem,
} from '@/platform/design-system/components/menu/action-menu'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'

interface Choice {
  label: string
  value: string
}

type ChoiceOption = string | Choice | { label: string; options: readonly Choice[] }

interface ChoiceMenuProps {
  id?: string
  label: string
  options: readonly ChoiceOption[]
  value?: string
  defaultValue?: string
  defaultOpen?: boolean
  onValueChange?: (value: string) => void
}

export function ChoiceMenu({
  id,
  label,
  options,
  value: controlledValue,
  defaultValue,
  defaultOpen = false,
  onValueChange,
}: ChoiceMenuProps) {
  const [localValue, setLocalValue] = useState(defaultValue)
  const selection = controlledValue ?? localValue
  const choices = options.flatMap((option) =>
    typeof option === 'string'
      ? [{ label: option, value: option }]
      : 'options' in option
        ? option.options
        : [option]
  )
  const selected = choices.find((choice) => choice.value === selection) ?? choices[0]
  const { trigger, container } = usePopoverContainer()
  function change(next: string) {
    if (controlledValue === undefined) setLocalValue(next)
    onValueChange?.(next)
  }
  return (
    <Menu.Root modal={false} defaultOpen={defaultOpen && choices.length > 0}>
      <Button
        render={
          <Menu.Trigger
            id={id}
            ref={trigger}
            aria-label={selected ? `${label}: ${selected.label}` : label}
          />
        }
        disabled={!choices.length}
        variant='quiet'
        size='compact'
      >
        {selected?.label || label}
      </Button>
      <ActionMenuPopup label={label} container={container} align='end'>
        <Menu.RadioGroup value={selected?.value} onValueChange={change}>
          {options.map((option) => {
            if (typeof option === 'string')
              return <MenuItem key={option} label={option} value={option} />
            if ('options' in option)
              return (
                <SubmenuItem key={option.label} label={option.label}>
                  <Menu.RadioGroup value={selected?.value} onValueChange={change}>
                    {option.options.map((choice) => (
                      <MenuItem key={choice.value} label={choice.label} value={choice.value} />
                    ))}
                  </Menu.RadioGroup>
                </SubmenuItem>
              )
            return <MenuItem key={option.value} label={option.label} value={option.value} />
          })}
        </Menu.RadioGroup>
      </ActionMenuPopup>
    </Menu.Root>
  )
}
