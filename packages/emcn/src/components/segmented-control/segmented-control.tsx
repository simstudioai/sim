'use client'

import { useId, useState } from 'react'
import type { IconName } from '#emcn/components/icon/icon'
import { Icon } from '#emcn/components/icon/icon'
import styles from '#emcn/components/segmented-control/segmented-control.module.css'

interface Choice<Value extends string = string> {
  value: Value
  label: string
  icon?: IconName
  disabled?: boolean
}

interface SelectionItemProps extends Choice {
  name: string
  checked?: boolean
  defaultChecked?: boolean
  onReselect?: () => void
  onSelect?: (value: string) => void
}

export function SelectionItem({
  name,
  label,
  value,
  icon,
  checked,
  disabled,
  defaultChecked,
  onReselect,
  onSelect,
}: SelectionItemProps) {
  return (
    <label className={styles.choice}>
      <input
        type='radio'
        className={styles.radio}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        defaultChecked={defaultChecked}
        onClick={
          onReselect &&
          ((event) => {
            if (event.detail > 0) onReselect()
          })
        }
        onChange={onSelect && (() => onSelect(value))}
      />
      <span
        className={styles.choiceLabel}
        data-icon={icon ? true : undefined}
        data-type={icon ? 'T056' : 'T057'}
      >
        {icon && <Icon name={icon} />}
        {label}
      </span>
    </label>
  )
}

type SegmentedControlProps<Value extends string> = {
  label: string
  description?: string
  options: readonly Choice<Value>[]
  onSelect?: (value: Value) => void
  /** Reselecting does nothing, for a two-way choice too consequential to flip by accident. */
  holdOnReselect?: boolean
} & ({ value: Value; defaultValue?: never } | { value?: never; defaultValue: Value })

export function SegmentedControl<Value extends string>({
  label,
  description,
  options,
  value,
  defaultValue,
  onSelect,
  holdOnReselect,
}: SegmentedControlProps<Value>) {
  const group = useId()
  const [localValue, setLocalValue] = useState(defaultValue)
  const selected = value ?? localValue
  function select(next: Value) {
    if (value === undefined) setLocalValue(next)
    onSelect?.(next)
  }
  return (
    <fieldset className={styles.segmented} aria-label={label} aria-description={description}>
      {options.map((option, index) => (
        <SelectionItem
          key={option.value}
          name={group}
          value={option.value}
          label={option.label}
          icon={option.icon}
          disabled={option.disabled}
          checked={selected === option.value}
          onSelect={() => select(option.value)}
          onReselect={
            !holdOnReselect &&
            options.length === 2 &&
            selected === option.value &&
            !options[1 - index].disabled
              ? () => select(options[1 - index].value)
              : undefined
          }
        />
      ))}
    </fieldset>
  )
}
