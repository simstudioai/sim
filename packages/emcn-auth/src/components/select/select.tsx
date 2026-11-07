'use client'

import { Combobox } from '@base-ui/react/combobox'
import { Select } from '@base-ui/react/select'
import { Icon } from '@sim/emcn/icon'
import { OverflowText } from '@sim/emcn/overflow-text'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { clsx } from 'clsx'
import input from '#auth/components/input/input.shared.module.css'
import popup from '#auth/components/popup/popup.shared.module.css'
import { useAuthPortal } from '#auth/components/root/context'
import styles from '#auth/components/select/select.module.css'

export interface AuthSelectOption {
  label: string
  value: string
  disabled?: boolean
}

interface AuthSelectProps {
  options: AuthSelectOption[]
  value?: string
  onChange?: (value: string) => void
  disabled?: boolean
  placeholder?: string
  displayLabel?: string
  searchable?: boolean
  searchPlaceholder?: string
  className?: string
  id?: string
  'aria-label'?: string
}

/** Uses the same field and popup recipes for native-choice and filterable option lists. */
export function AuthSelect({
  options,
  value,
  onChange,
  disabled,
  placeholder = 'Select an option',
  displayLabel,
  searchable,
  searchPlaceholder = 'Search',
  className,
  id,
  'aria-label': ariaLabel,
}: AuthSelectProps) {
  const portal = useAuthPortal()
  const scrollEdges = useScrollEdges<HTMLDivElement>()
  const selected = options.find((option) => option.value === value)
  const label = displayLabel ?? selected?.label ?? placeholder
  const trigger = (
    <span className={input.inputSurface}>
      <span className={styles.value}>
        <OverflowText text={label}>{label}</OverflowText>
      </span>
      <Icon name='I051' />
    </span>
  )

  if (searchable) {
    return (
      <Combobox.Root
        items={options}
        value={selected ?? null}
        onValueChange={(option) => {
          if (option) onChange?.(option.value)
        }}
        isItemEqualToValue={(option, current) => option.value === current.value}
        disabled={disabled}
        autoHighlight
        modal={false}
      >
        <Combobox.Trigger
          id={id}
          aria-label={ariaLabel ?? placeholder}
          className={clsx(styles.select, className)}
        >
          {trigger}
        </Combobox.Trigger>
        {portal && (
          <Combobox.Portal container={portal}>
            <Combobox.Positioner
              align='start'
              sideOffset={4}
              collisionPadding={16}
              className={popup.positioner}
            >
              <Combobox.Popup className={popup.menu} aria-label={ariaLabel ?? placeholder}>
                <Combobox.Input
                  className={popup.menuSearch}
                  aria-label={searchPlaceholder}
                  placeholder={searchPlaceholder}
                />
                <Combobox.Empty className={popup.empty}>No matching options</Combobox.Empty>
                <Combobox.List ref={scrollEdges} className={popup.options}>
                  {(option: AuthSelectOption) => (
                    <Combobox.Item
                      key={option.value}
                      value={option}
                      disabled={option.disabled}
                      className={popup.menuRow}
                    >
                      <span>{option.label}</span>
                      <Combobox.ItemIndicator className={popup.indicator} keepMounted>
                        <Icon name='I072' />
                      </Combobox.ItemIndicator>
                    </Combobox.Item>
                  )}
                </Combobox.List>
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        )}
      </Combobox.Root>
    )
  }

  return (
    <Select.Root
      items={options}
      value={value ?? null}
      onValueChange={(next) => {
        if (next !== null) onChange?.(next)
      }}
      disabled={disabled}
      modal={false}
    >
      <Select.Trigger
        id={id}
        aria-label={ariaLabel ?? placeholder}
        className={clsx(styles.select, className)}
      >
        {trigger}
      </Select.Trigger>
      {portal && (
        <Select.Portal container={portal}>
          <Select.Positioner
            align='start'
            sideOffset={4}
            alignItemWithTrigger={false}
            collisionPadding={16}
            className={popup.positioner}
          >
            <Select.Popup className={popup.menu} aria-label={ariaLabel ?? placeholder}>
              <Select.List ref={scrollEdges} className={popup.options}>
                {options.map((option) => (
                  <Select.Item
                    key={option.value}
                    value={option.value}
                    disabled={option.disabled}
                    className={popup.menuRow}
                  >
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <Select.ItemIndicator className={popup.indicator} keepMounted>
                      <Icon name='I072' />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      )}
    </Select.Root>
  )
}
