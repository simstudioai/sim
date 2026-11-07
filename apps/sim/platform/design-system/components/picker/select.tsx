'use client'

import { Select as BaseSelect } from '@base-ui/react/select'
import type { ControlProps } from '@/platform/design-system/components/field/inputs'
import { Icon } from '@/platform/design-system/components/icon/icon'
import popup from '@/platform/design-system/components/menu/popup.shared.module.css'
import picker from '@/platform/design-system/components/picker/picker.module.css'
import { usePickerValue } from '@/platform/design-system/components/picker/use-picker-value'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

const optionValue = (option: { value: string }) => option.value

interface SelectProps<Value extends string> extends ControlProps {
  variant?: 'quiet'
  /** Fills its container, for a control in a fixed column. */
  block?: boolean
  value?: Value
  onValueChange?: (value: Value) => void
  options: ReadonlyArray<{ value: Value; label: string }>
}

export function Select<Value extends string>({
  id,
  label,
  name,
  options,
  variant,
  block,
  value,
  onValueChange,
  defaultValue,
  disabled,
  invalid,
  describedBy,
}: SelectProps<Value>) {
  const valueEdges = useScrollEdges<HTMLSpanElement>('horizontal')
  const scrollRef = useScrollEdges<HTMLDivElement>()
  const selection = usePickerValue(options, optionValue, defaultValue)
  return (
    <BaseSelect.Root
      items={options}
      name={name}
      value={value ?? selection.value}
      onValueChange={(value) => {
        selection.setValue(value)
        if (value !== null) onValueChange?.(value as Value)
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
        data-block={block || undefined}
        data-type={variant === 'quiet' ? 'T057' : 'T043'}
      >
        <BaseSelect.Value ref={valueEdges} className={picker.value} />
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
              <BaseSelect.List ref={scrollRef} className={popup.list}>
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
