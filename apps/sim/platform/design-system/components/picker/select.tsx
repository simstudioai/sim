'use client'

import { Select as BaseSelect } from '@base-ui/react/select'
import type { ControlProps } from '@/platform/design-system/components/field/inputs'
import { Icon } from '@/platform/design-system/components/icon/icon'
import popup from '@/platform/design-system/components/menu/popup.shared.module.css'
import picker from '@/platform/design-system/components/picker/picker.module.css'
import { usePickerValue } from '@/platform/design-system/components/picker/use-picker-value'

const optionValue = (option: { value: string }) => option.value

interface SelectProps extends ControlProps {
  variant?: 'quiet'
  value?: string
  onValueChange?: (value: string) => void
  options: ReadonlyArray<{ value: string; label: string }>
}

export function Select({
  id,
  label,
  name,
  options,
  variant,
  value,
  onValueChange,
  defaultValue,
  disabled,
  invalid,
  describedBy,
}: SelectProps) {
  const selection = usePickerValue(options, optionValue, defaultValue)
  return (
    <BaseSelect.Root
      items={options}
      name={name}
      value={value ?? selection.value}
      onValueChange={(value) => {
        selection.setValue(value)
        if (value !== null) onValueChange?.(value)
      }}
      disabled={disabled || options.length === 0}
      modal={false}
    >
      <BaseSelect.Trigger
        id={id}
        ref={selection.trigger}
        aria-label={label}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={picker.trigger}
        data-variant={variant}
        data-type={variant === 'quiet' ? 'T057' : 'T043'}
      >
        <BaseSelect.Value className={picker.value} />
        <Icon name='I051' />
      </BaseSelect.Trigger>
      {selection.container && (
        <BaseSelect.Portal container={selection.container}>
          <BaseSelect.Positioner
            align='start'
            sideOffset={8}
            alignItemWithTrigger={false}
            positionMethod='fixed'
            className={popup.anchorWidth}
          >
            <BaseSelect.Popup
              aria-label={label}
              className={popup.popup}
              data-material='floating'
              data-elevation='menu'
            >
              <BaseSelect.List className={popup.list}>
                {options.map(({ value, label: text }) => (
                  <BaseSelect.Item
                    key={value}
                    value={value}
                    className={popup.item}
                    data-type='T060'
                  >
                    <BaseSelect.ItemText className={popup.label}>{text}</BaseSelect.ItemText>
                    <BaseSelect.ItemIndicator className={popup.indicator}>
                      <Icon name='I072' />
                    </BaseSelect.ItemIndicator>
                  </BaseSelect.Item>
                ))}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      )}
    </BaseSelect.Root>
  )
}
