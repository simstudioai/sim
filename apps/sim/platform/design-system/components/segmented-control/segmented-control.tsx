'use client'

import { useId, useState } from 'react'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import { Icon } from '@/platform/design-system/components/icon/icon'
import styles from '@/platform/design-system/components/segmented-control/segmented-control.module.css'

interface Choice {
  value: string
  label: string
  icon?: IconName
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

interface SegmentedControlProps {
  label: string
  options: readonly Choice[]
  defaultValue: string
  onSelect?: (value: string) => void
}

export function SegmentedControl({
  label,
  options,
  defaultValue,
  onSelect,
}: SegmentedControlProps) {
  const group = useId()
  const [selected, setSelected] = useState(defaultValue)
  function select(value: string) {
    setSelected(value)
    onSelect?.(value)
  }
  return (
    <fieldset className={styles.segmented} aria-label={label}>
      {options.map((option, index) => (
        <SelectionItem
          key={option.value}
          name={group}
          value={option.value}
          label={option.label}
          icon={option.icon}
          checked={selected === option.value}
          onSelect={select}
          onReselect={
            options.length === 2 && selected === option.value
              ? () => select(options[1 - index].value)
              : undefined
          }
        />
      ))}
    </fieldset>
  )
}
