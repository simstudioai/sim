'use client'

import { useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Button } from '#emcn/components/button/button'
import { ActionMenuPopup, MenuItem, SubmenuItem } from '#emcn/components/menu/action-menu'
import { usePopoverContainer } from '#emcn/components/menu/use-popover-container'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

interface Choice {
  label: string
  value: string
  disabled?: boolean
  disabledReason?: string
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
  disabled?: boolean
  disabledReason?: string
}

export function ChoiceMenu({
  id,
  label,
  options,
  value: controlledValue,
  defaultValue,
  defaultOpen = false,
  onValueChange,
  disabled,
  disabledReason,
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
  const control = (
    <Button
      render={
        <Menu.Trigger
          id={id}
          ref={trigger}
          aria-label={selected ? `${label}: ${selected.label}` : label}
        />
      }
      disabled={disabled || !choices.length}
      variant='quiet'
      size='compact'
    >
      {selected?.label || label}
    </Button>
  )
  return (
    <Menu.Root
      modal={false}
      disabled={disabled}
      defaultOpen={defaultOpen && choices.length > 0 && !disabled}
    >
      {disabled && disabledReason ? (
        <Tooltip label={disabledReason} disabledControl>
          {control}
        </Tooltip>
      ) : (
        control
      )}
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
                      <MenuItem
                        key={choice.value}
                        label={choice.label}
                        value={choice.value}
                        disabled={choice.disabled}
                        disabledReason={choice.disabledReason}
                      />
                    ))}
                  </Menu.RadioGroup>
                </SubmenuItem>
              )
            return (
              <MenuItem
                key={option.value}
                label={option.label}
                value={option.value}
                disabled={option.disabled}
                disabledReason={option.disabledReason}
              />
            )
          })}
        </Menu.RadioGroup>
      </ActionMenuPopup>
    </Menu.Root>
  )
}
