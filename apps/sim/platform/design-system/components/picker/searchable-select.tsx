'use client'

import { useId, useMemo, useRef } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { FieldFrame, fieldDescription } from '@/platform/design-system/components/field/fields'
import { Icon } from '@/platform/design-system/components/icon/icon'
import popup from '@/platform/design-system/components/menu/popup.shared.module.css'
import picker from '@/platform/design-system/components/picker/picker.module.css'
import {
  optionKeys,
  type PickerOption,
  type PickerServerSearch,
  SearchPopup,
} from '@/platform/design-system/components/picker/search-popup'
import { usePickerValue } from '@/platform/design-system/components/picker/use-picker-value'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface SearchableSelectProps {
  label: string
  labelHidden?: boolean
  /** `text` sits in a line of copy, such as a breadcrumb, with a popup wider than its label. */
  variant?: 'field' | 'text'
  options: readonly PickerOption[]
  defaultValue?: string
  /** Controlled selection, where `null` holds nothing. It may be absent from the current `options`. */
  value?: string | null
  onValueChange?: (value: string | null) => void
  /** The trigger's text for a controlled `value` the current `options` may not contain. */
  selectedLabel?: string
  placeholder?: string
  searchLabel: string
  /** Needs a controlled `value`: a selection may leave the current `options`. */
  search?: PickerServerSearch
  /** Lets a caller read its options only once the viewer asks for them. */
  onOpenChange?: (open: boolean) => void
  name?: string
  disabled?: boolean
  error?: string
  hint?: string
  createLabel?: string
  onCreate?: () => void
}

export function SearchableSelect({
  label,
  labelHidden,
  variant = 'field',
  options,
  defaultValue,
  value,
  onValueChange,
  selectedLabel,
  placeholder,
  searchLabel,
  search,
  onOpenChange,
  name,
  disabled,
  error,
  hint,
  createLabel,
  onCreate,
}: SearchableSelectProps) {
  const id = useId()
  const actions = useRef<Combobox.Root.Actions>(null)
  const valueEdges = useScrollEdges<HTMLSpanElement>('horizontal')
  const selection = usePickerValue(options, optionKeys.getValue, defaultValue)
  const items = useMemo(() => Combobox.createItems(options, optionKeys), [options])
  const current = value === undefined ? selection.value : value
  return (
    <FieldFrame id={id} label={label} labelHidden={labelHidden} error={error} hint={hint}>
      <Combobox.Root
        items={items}
        value={current}
        name={name}
        filter={search ? null : undefined}
        inputValue={search?.query}
        onInputValueChange={search?.onQueryChange}
        onOpenChange={onOpenChange}
        onValueChange={(next) => {
          selection.setValue(next)
          onValueChange?.(next)
        }}
        autoHighlight
        actionsRef={actions}
        disabled={disabled || (options.length === 0 && !createLabel && !search)}
        modal={false}
      >
        <Combobox.Trigger
          id={id}
          ref={selection.trigger}
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescription(id, error, hint)}
          className={picker.trigger}
          data-variant={variant === 'text' ? 'text' : undefined}
          data-empty={current === null && placeholder ? true : undefined}
          data-type='T043'
        >
          <span ref={valueEdges} className={picker.value}>
            {current === null && placeholder ? placeholder : (selectedLabel ?? <Combobox.Value />)}
          </span>
          <Icon name='I051' />
        </Combobox.Trigger>
        {selection.container && (
          <SearchPopup
            label={label}
            searchLabel={searchLabel}
            container={selection.container}
            search={search}
            detached={variant === 'text'}
          >
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
          </SearchPopup>
        )}
      </Combobox.Root>
    </FieldFrame>
  )
}
