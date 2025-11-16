import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Combobox as EditableCombobox } from '@/components/emcn/components'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/components/sub-block-input-controller'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import type { SelectorContext, SelectorKey } from '@/hooks/selectors/types'
import {
  useSelectorOptionDetail,
  useSelectorOptionMap,
  useSelectorOptions,
} from '@/hooks/selectors/use-selector-query'

interface SelectorComboboxProps {
  blockId: string
  subBlock: SubBlockConfig
  selectorKey: SelectorKey
  selectorContext: SelectorContext
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
  placeholder?: string
  readOnly?: boolean
  onOptionChange?: (value: string) => void
  allowSearch?: boolean
}

export function SelectorCombobox({
  blockId,
  subBlock,
  selectorKey,
  selectorContext,
  disabled,
  isPreview,
  previewValue,
  placeholder,
  readOnly,
  onOptionChange,
  allowSearch = true,
}: SelectorComboboxProps) {
  const [storeValueRaw, setStoreValue] = useSubBlockValue<string | null | undefined>(
    blockId,
    subBlock.id
  )
  const storeValue = storeValueRaw ?? undefined
  const previewedValue = previewValue ?? undefined
  const activeValue: string | undefined = isPreview ? previewedValue : storeValue
  const [searchTerm, setSearchTerm] = useState('')
  const [isEditing, setIsEditing] = useState(false)
  const {
    data: options = [],
    isLoading,
    error,
  } = useSelectorOptions(selectorKey, {
    context: selectorContext,
    search: allowSearch ? searchTerm : undefined,
  })
  const { data: detailOption } = useSelectorOptionDetail(selectorKey, {
    context: selectorContext,
    detailId: activeValue,
  })
  const optionMap = useSelectorOptionMap(options, detailOption ?? undefined)
  const selectedLabel = activeValue ? (optionMap.get(activeValue)?.label ?? activeValue) : ''
  const [inputValue, setInputValue] = useState(selectedLabel)
  const previousActiveValue = useRef<string | undefined>(activeValue)

  useEffect(() => {
    if (previousActiveValue.current !== activeValue) {
      previousActiveValue.current = activeValue
      setIsEditing(false)
    }
  }, [activeValue])

  useEffect(() => {
    if (!allowSearch) return
    if (!isEditing) {
      setInputValue(selectedLabel)
    }
  }, [selectedLabel, allowSearch, isEditing])

  const comboboxOptions = useMemo(
    () =>
      Array.from(optionMap.values()).map((option) => ({
        label: option.label,
        value: option.id,
      })),
    [optionMap]
  )

  const handleSelection = useCallback(
    (value: string) => {
      if (readOnly || disabled) return
      setStoreValue(value)
      setIsEditing(false)
      onOptionChange?.(value)
    },
    [setStoreValue, onOptionChange, readOnly, disabled]
  )

  return (
    <div className='w-full'>
      <SubBlockInputController
        blockId={blockId}
        subBlockId={subBlock.id}
        config={subBlock}
        value={activeValue ?? ''}
        disabled={disabled || readOnly}
        isPreview={isPreview}
      >
        {({ ref, onDrop, onDragOver }) => (
          <EditableCombobox
            options={comboboxOptions}
            value={allowSearch ? inputValue : selectedLabel}
            selectedValue={activeValue ?? ''}
            onChange={(newValue) => {
              const matched = optionMap.get(newValue)
              if (matched) {
                setInputValue(matched.label)
                setIsEditing(false)
                handleSelection(matched.id)
                return
              }
              if (allowSearch) {
                setInputValue(newValue)
                setIsEditing(true)
                setSearchTerm(newValue)
              }
            }}
            placeholder={placeholder || subBlock.placeholder || 'Select an option'}
            disabled={disabled || readOnly}
            editable={allowSearch}
            filterOptions={true}
            inputRef={ref as React.RefObject<HTMLInputElement>}
            inputProps={{
              onDrop: onDrop as (e: React.DragEvent<HTMLInputElement>) => void,
              onDragOver: onDragOver as (e: React.DragEvent<HTMLInputElement>) => void,
            }}
            isLoading={isLoading}
            error={error instanceof Error ? error.message : null}
          />
        )}
      </SubBlockInputController>
    </div>
  )
}
