'use client'

import { useId, useMemo } from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { FieldFrame, fieldDescription } from '@/platform/design-system/components/field/fields'
import { Icon } from '@/platform/design-system/components/icon/icon'
import { usePopoverContainer } from '@/platform/design-system/components/menu/use-popover-container'
import picker from '@/platform/design-system/components/picker/picker.module.css'
import {
  optionKeys,
  type PickerOption,
  type PickerServerSearch,
  SearchPopup,
} from '@/platform/design-system/components/picker/search-popup'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'

interface MultiSelectProps {
  variant?: 'quiet'
  label: string
  labelHidden?: boolean
  options: readonly PickerOption[]
  value: readonly string[]
  onValueChange: (value: string[]) => void
  /** Trigger text for selected values the current `options` may not contain. */
  selectedLabels?: Readonly<Record<string, string>>
  placeholder?: string
  searchLabel: string
  search?: PickerServerSearch
  name?: string
  disabled?: boolean
  error?: string
  hint?: string
}

export function MultiSelect({
  variant,
  label,
  labelHidden,
  options,
  value,
  onValueChange,
  selectedLabels,
  placeholder = 'None selected',
  searchLabel,
  search,
  name,
  disabled,
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
  return (
    <FieldFrame id={id} label={label} labelHidden={labelHidden} error={error} hint={hint}>
      <Combobox.Root
        multiple
        items={items}
        value={[...value]}
        name={name}
        filter={search ? null : undefined}
        inputValue={search?.query}
        onInputValueChange={search?.onQueryChange}
        onValueChange={onValueChange}
        autoHighlight
        disabled={disabled}
        modal={false}
      >
        <Combobox.Trigger
          id={id}
          ref={trigger}
          aria-label={`${label}: ${summary}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescription(id, error, hint)}
          className={picker.trigger}
          data-empty={value.length === 0 ? true : undefined}
          data-variant={variant}
          data-type={variant === 'quiet' ? 'T057' : 'T043'}
        >
          <span ref={valueEdges} className={picker.value}>
            {summary}
          </span>
          <Icon name='I051' />
        </Combobox.Trigger>
        {container && (
          <SearchPopup
            label={label}
            searchLabel={searchLabel}
            container={container}
            search={search}
          />
        )}
      </Combobox.Root>
    </FieldFrame>
  )
}
