'use client'

import { useId, useMemo, useRef } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Button } from '#emcn/components/button/button'
import { FieldFrame, fieldDescription } from '#emcn/components/field/frame'
import { Icon } from '#emcn/components/icon/icon'
import popup from '#emcn/components/menu/popup.shared.module.css'
import picker from '#emcn/components/picker/picker.module.css'
import {
  optionKeys,
  type PickerOption,
  type PickerServerSearch,
  SearchPopup,
} from '#emcn/components/picker/search-popup'
import { usePickerValue } from '#emcn/components/picker/use-picker-value'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

interface SearchableSelectProps {
  label: string
  labelHidden?: boolean
  /** `text` uses the compact toolbar button with a popup wider than its label. */
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
  disabledReason?: string
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
  disabledReason,
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
  const selectedOption = options.find((option) => optionKeys.getValue(option) === current)
  const text =
    selectedLabel ?? (selectedOption ? optionKeys.getLabel(selectedOption) : (placeholder ?? label))
  const control =
    variant === 'text' ? (
      <Button
        render={
          <Combobox.Trigger
            id={id}
            ref={selection.trigger}
            aria-label={`${label}: ${text}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={[`${id}-value`, fieldDescription(id, error, hint)]
              .filter(Boolean)
              .join(' ')}
          />
        }
        variant='quiet'
        size='compact'
        disabled={disabled}
      >
        {text}
      </Button>
    ) : (
      <Combobox.Trigger
        id={id}
        ref={selection.trigger}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        aria-describedby={[`${id}-value`, fieldDescription(id, error, hint)]
          .filter(Boolean)
          .join(' ')}
        className={picker.trigger}
        data-empty={current === null && placeholder ? true : undefined}
        data-type='T043'
      >
        <span id={`${id}-value`} ref={valueEdges} className={picker.value}>
          {current === null && placeholder ? placeholder : (selectedLabel ?? <Combobox.Value />)}
        </span>
        <Icon name='I051' />
      </Combobox.Trigger>
    )
  const content = (
    <>
      {variant === 'text' && (
        <span id={`${id}-value`} data-visually-hidden>
          {text}
        </span>
      )}
      {disabled && disabledReason ? (
        <Tooltip label={disabledReason} disabledControl>
          {control}
        </Tooltip>
      ) : (
        control
      )}
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
    </>
  )
  const field =
    variant === 'text' && !error && !hint ? (
      <span className={picker.inlineControl}>{content}</span>
    ) : (
      <FieldFrame
        id={id}
        label={label}
        labelRender={<Combobox.Label />}
        labelHidden={variant === 'text' || labelHidden}
        error={error}
        hint={hint}
      >
        {content}
      </FieldFrame>
    )
  return (
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
      {field}
    </Combobox.Root>
  )
}
