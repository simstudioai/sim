'use client'

import { useId } from 'react'
import { Checkbox as BaseCheckbox } from '@base-ui/react/checkbox'
import styles from '#emcn/components/checkbox/checkbox.module.css'
import { Icon } from '#emcn/components/icon/icon'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

interface CheckboxProps {
  label: string
  description?: string
  /** Name the box for assistive technology only, for a grid or table that labels it visually. */
  labelHidden?: boolean
  checked?: boolean
  defaultChecked?: boolean
  indeterminate?: boolean
  disabled?: boolean
  /** Explain a protected choice without allowing it to be selected. */
  disabledReason?: string
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
  disabledReason,
  name,
  value,
  onCheckedChange,
}: CheckboxProps) {
  const id = useId()
  const control = (
    <BaseCheckbox.Root
      id={id}
      aria-labelledby={`${id}-label`}
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
  )
  return (
    <label
      htmlFor={id}
      className={styles.checkbox}
      data-disabled={disabled || undefined}
      data-label-hidden={labelHidden || undefined}
    >
      {disabled && disabledReason ? (
        <Tooltip label={disabledReason} disabledControl>
          {control}
        </Tooltip>
      ) : (
        control
      )}
      <span
        id={`${id}-label`}
        className={styles.copy}
        data-visually-hidden={labelHidden || undefined}
      >
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
