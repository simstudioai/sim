'use client'

import { useId, useMemo } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { Button } from '#emcn/components/button/button'
import { FieldFrame, fieldDescription } from '#emcn/components/field/frame'
import { Icon } from '#emcn/components/icon/icon'
import { usePopoverContainer } from '#emcn/components/menu/use-popover-container'
import picker from '#emcn/components/picker/picker.module.css'
import {
  optionKeys,
  type PickerOption,
  type PickerServerSearch,
  SearchPopup,
} from '#emcn/components/picker/search-popup'
import { useScrollEdges } from '#emcn/components/scroll-area/use-scroll-edges'
import { Tooltip } from '#emcn/components/tooltip/tooltip'

interface MultiSelectProps {
  label: string
  labelHidden?: boolean
  variant?: 'field' | 'text'
  options: readonly PickerOption[]
  value: readonly string[]
  onValueChange: (value: string[]) => void
  /** Trigger text for selected values the current `options` may not contain. */
  selectedLabels?: Readonly<Record<string, string>>
  placeholder?: string
  searchLabel: string
  search?: PickerServerSearch
  /** Lets a caller read its options only once the viewer asks for them, as provider-backed lists do. */
  onOpenChange?: (open: boolean) => void
  name?: string
  disabled?: boolean
  disabledReason?: string
  error?: string
  hint?: string
}

export function MultiSelect({
  label,
  labelHidden,
  variant = 'field',
  options,
  value,
  onValueChange,
  selectedLabels,
  placeholder = 'None selected',
  searchLabel,
  search,
  onOpenChange,
  name,
  disabled,
  disabledReason,
  error,
  hint,
}: MultiSelectProps) {
  const id = useId()
  const { trigger, container } = usePopoverContainer()
  const valueEdges = useScrollEdges<HTMLSpanElement>('horizontal')
  const items = useMemo(() => Combobox.createItems(options, optionKeys), [options])
  const [only] = value
  const onlyOption = options.find((option) => optionKeys.getValue(option) === only)
  const summary =
    value.length === 0
      ? placeholder
      : value.length > 1
        ? `${value.length} selected`
        : (selectedLabels?.[only] ?? (onlyOption ? optionKeys.getLabel(onlyOption) : only))
  const control =
    variant === 'text' ? (
      <Button
        render={
          <Combobox.Trigger
            id={id}
            ref={trigger}
            aria-label={`${label}: ${summary}`}
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
        {summary}
      </Button>
    ) : (
      <Combobox.Trigger
        id={id}
        ref={trigger}
        aria-label={`${label}: ${summary}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[`${id}-value`, fieldDescription(id, error, hint)]
          .filter(Boolean)
          .join(' ')}
        className={picker.trigger}
        data-empty={value.length === 0 ? true : undefined}
        data-type='T043'
      >
        <span id={`${id}-value`} ref={valueEdges} className={picker.value}>
          {summary}
        </span>
        <Icon name='I051' />
      </Combobox.Trigger>
    )
  const content = (
    <>
      {variant === 'text' && (
        <span id={`${id}-value`} data-visually-hidden>
          {summary}
        </span>
      )}
      {disabled && disabledReason ? (
        <Tooltip label={disabledReason} disabledControl>
          {control}
        </Tooltip>
      ) : (
        control
      )}
      {container && (
        <SearchPopup
          label={label}
          searchLabel={searchLabel}
          container={container}
          search={search}
          detached={variant === 'text'}
        />
      )}
    </>
  )
  const framedControl =
    variant === 'text' ? <span className={picker.inlineControl}>{content}</span> : content
  const field =
    variant === 'field' || error || hint ? (
      <FieldFrame
        id={id}
        label={label}
        labelRender={<Combobox.Label />}
        labelHidden={variant === 'text' || labelHidden}
        error={error}
        hint={hint}
      >
        {framedControl}
      </FieldFrame>
    ) : (
      framedControl
    )
  return (
    <Combobox.Root
      multiple
      items={items}
      value={[...value]}
      name={name}
      filter={search ? null : undefined}
      inputValue={search?.query}
      onInputValueChange={search?.onQueryChange}
      onOpenChange={onOpenChange}
      onValueChange={onValueChange}
      autoHighlight
      disabled={disabled}
      modal={false}
    >
      {field}
    </Combobox.Root>
  )
}
