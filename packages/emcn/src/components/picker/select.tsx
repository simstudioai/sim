'use client'

import { Select as BaseSelect } from '@base-ui/react/select'
import { FieldFrame, type FieldFrameProps } from '#emcn/components/field/frame'
import type { ControlProps } from '#emcn/components/field/inputs'
import { Icon } from '#emcn/components/icon/icon'
import popup from '#emcn/components/menu/popup.shared.module.css'
import picker from '#emcn/components/picker/picker.module.css'
import type { PickerOption } from '#emcn/components/picker/search-popup'
import { usePickerValue } from '#emcn/components/picker/use-picker-value'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

const optionValue = (option: { value: string }) => option.value

interface SelectProps extends ControlProps {
  value?: string
  onValueChange?: (value: string) => void
  options: readonly Exclude<PickerOption, string>[]
  disabledReason?: string
  field?: Omit<FieldFrameProps, 'label' | 'id' | 'children' | 'labelRender'>
}

export function Select({
  id,
  label,
  name,
  options,
  value,
  onValueChange,
  defaultValue,
  disabled,
  disabledReason,
  invalid,
  describedBy,
  field,
}: SelectProps) {
  const valueEdges = useScrollEdges<HTMLSpanElement>('horizontal')
  const scrollRef = useScrollEdges<HTMLDivElement>()
  const selection = usePickerValue(options, optionValue, defaultValue)
  const trigger = (
    <BaseSelect.Trigger
      id={id}
      ref={selection.trigger}
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-describedby={describedBy}
      className={picker.trigger}
      data-type='T043'
    >
      <BaseSelect.Value ref={valueEdges} className={picker.value} />
      <Icon name='I051' />
    </BaseSelect.Trigger>
  )
  const control =
    disabled && disabledReason ? (
      <Tooltip label={disabledReason} disabledControl>
        {trigger}
      </Tooltip>
    ) : (
      trigger
    )
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
      {field ? (
        <FieldFrame
          id={id}
          label={label}
          count={field.count}
          optional={field.optional}
          error={field.error}
          hint={field.hint}
          labelHidden={field.labelHidden}
          labelRender={<BaseSelect.Label />}
        >
          {control}
        </FieldFrame>
      ) : (
        control
      )}
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
                {options.map(({ value, label: text, disabled, disabledReason }) => {
                  const item = (
                    <BaseSelect.Item
                      key={value}
                      value={value}
                      disabled={disabled}
                      className={popup.item}
                      data-type='T060'
                    >
                      <BaseSelect.ItemText className={popup.label}>{text}</BaseSelect.ItemText>
                      <BaseSelect.ItemIndicator className={popup.indicator}>
                        <Icon name='I072' />
                      </BaseSelect.ItemIndicator>
                    </BaseSelect.Item>
                  )
                  return disabled && disabledReason ? (
                    <Tooltip key={value} label={disabledReason}>
                      {item}
                    </Tooltip>
                  ) : (
                    item
                  )
                })}
              </BaseSelect.List>
            </BaseSelect.Popup>
          </BaseSelect.Positioner>
        </BaseSelect.Portal>
      )}
    </BaseSelect.Root>
  )
}
