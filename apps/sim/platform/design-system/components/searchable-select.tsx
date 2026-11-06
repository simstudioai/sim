'use client'

import { useId, useMemo, useRef } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { FieldFrame } from '@/platform/design-system/components/fields'
import { Icon } from '@/platform/design-system/components/icon'
import picker from '@/platform/design-system/components/picker.module.css'
import popup from '@/platform/design-system/components/popup.module.css'
import { usePickerValue } from '@/platform/design-system/components/use-picker-value'

type Option = string | { value: string; label: string }

interface SearchableSelectProps {
  label: string
  options: readonly Option[]
  defaultValue: string
  searchLabel: string
  name?: string
  disabled?: boolean
  createLabel?: string
  onCreate?: () => void
}

const collectionKeys = {
  getValue: (option: Option) => (typeof option === 'string' ? option : option.value),
  getLabel: (option: Option) => (typeof option === 'string' ? option : option.label),
}

export function SearchableSelect({
  label,
  options,
  defaultValue,
  searchLabel,
  name,
  disabled,
  createLabel,
  onCreate,
}: SearchableSelectProps) {
  const id = useId()
  const actions = useRef<Combobox.Root.Actions>(null)
  const input = useRef<HTMLInputElement>(null)
  const selection = usePickerValue(options, collectionKeys.getValue, defaultValue)
  const items = useMemo(() => Combobox.createItems(options, collectionKeys), [options])
  return (
    <FieldFrame id={id} label={label}>
      <Combobox.Root
        items={items}
        value={selection.value}
        name={name}
        onValueChange={selection.setValue}
        autoHighlight
        actionsRef={actions}
        disabled={disabled || (options.length === 0 && !createLabel)}
        modal={false}
      >
        <Combobox.Trigger
          id={id}
          ref={selection.trigger}
          aria-label={label}
          className={picker.trigger}
          data-type='T043'
        >
          <span className={picker.value}>
            <Combobox.Value />
          </span>
          <Icon name='I051' />
        </Combobox.Trigger>
        {selection.container && (
          <Combobox.Portal container={selection.container}>
            <Combobox.Positioner
              align='start'
              positionMethod='fixed'
              sideOffset={8}
              className={popup.anchorWidth}
            >
              <Combobox.Popup
                className={popup.popup}
                data-material='floating'
                data-elevation='menu'
                aria-label={label}
                initialFocus={input}
              >
                <div className={picker.search}>
                  <Icon name='I089' />
                  <Combobox.Input
                    ref={input}
                    aria-label={searchLabel}
                    placeholder={searchLabel}
                    data-type='T060'
                  />
                </div>
                <Combobox.Empty className={picker.empty} data-type='T060'>
                  No matches
                </Combobox.Empty>
                <Combobox.List aria-label={label} className={popup.list}>
                  {(option: Option) => (
                    <Combobox.Item
                      key={collectionKeys.getValue(option)}
                      value={collectionKeys.getValue(option)}
                      className={popup.item}
                      data-type='T060'
                    >
                      <span className={popup.label}>{collectionKeys.getLabel(option)}</span>
                      <Combobox.ItemIndicator className={popup.indicator}>
                        <Icon name='I072' />
                      </Combobox.ItemIndicator>
                    </Combobox.Item>
                  )}
                </Combobox.List>
                {createLabel && (
                  <>
                    <Combobox.Separator className={popup.separator} />
                    <button
                      type='button'
                      className={popup.item}
                      data-type='T060'
                      onClick={() => {
                        actions.current?.close()
                        onCreate?.()
                      }}
                    >
                      <Icon name='I074' />
                      {createLabel}
                    </button>
                  </>
                )}
              </Combobox.Popup>
            </Combobox.Positioner>
          </Combobox.Portal>
        )}
      </Combobox.Root>
    </FieldFrame>
  )
}
