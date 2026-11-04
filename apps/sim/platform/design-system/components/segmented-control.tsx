import { useId } from 'react'
import type { IconName } from '@/platform/design-system/catalog/icon-geometry'
import styles from '@/platform/design-system/components/choices.module.css'
import { Icon } from '@/platform/design-system/components/icon'

interface Choice {
  value: string
  label: string
  icon?: IconName
}

interface SelectionItemProps extends Choice {
  name: string
  defaultChecked?: boolean
  onSelect?: (value: string) => void
}

export function SelectionItem({
  name,
  label,
  value,
  icon,
  defaultChecked,
  onSelect,
}: SelectionItemProps) {
  return (
    <label className={styles.choice}>
      <input
        type='radio'
        className={styles.radio}
        name={name}
        value={value}
        defaultChecked={defaultChecked}
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
  return (
    <fieldset className={styles.segmented} aria-label={label}>
      {options.map((option) => (
        <SelectionItem
          key={option.value}
          name={group}
          value={option.value}
          label={option.label}
          icon={option.icon}
          defaultChecked={defaultValue === option.value}
          onSelect={onSelect}
        />
      ))}
    </fieldset>
  )
}
