'use client'

import { useId } from 'react'
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import styles from '@/platform/design-system/components/checkbox/checkbox.module.css'
import { Icon } from '@/platform/design-system/components/icon/icon'

interface CheckboxProps {
  label: string
  description?: string
  /** Name the box for assistive technology only, for a grid or table that labels it visually. */
  labelHidden?: boolean
  checked?: boolean
  defaultChecked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  name?: string
  value?: string
  onCheckedChange?: (checked: boolean) => void
}

export function Checkbox({
  label,
  description,
  labelHidden,
  checked,
  defaultChecked,
  indeterminate,
  disabled,
  name,
  value,
  onCheckedChange,
}: CheckboxProps) {
  const id = useId()
  return (
    <label htmlFor={id} className={styles.checkbox} data-disabled={disabled || undefined}>
      <BaseCheckbox.Root
        id={id}
        className={styles.box}
        checked={checked}
        defaultChecked={defaultChecked}
        indeterminate={indeterminate}
        disabled={disabled}
        name={name}
        value={value}
        onCheckedChange={onCheckedChange}
      >
        <BaseCheckbox.Indicator className={styles.indicator} data-solid data-type='T050'>
          {indeterminate ? <span className={styles.dash} /> : <Icon name='I072' />}
        </BaseCheckbox.Indicator>
      </BaseCheckbox.Root>
      <span className={styles.copy} data-visually-hidden={labelHidden || undefined}>
        <span data-type='T043'>{label}</span>
        {description && (
          <span className={styles.description} data-type='T060'>
            {description}
          </span>
        )}
      </span>
    </label>
  )
}
