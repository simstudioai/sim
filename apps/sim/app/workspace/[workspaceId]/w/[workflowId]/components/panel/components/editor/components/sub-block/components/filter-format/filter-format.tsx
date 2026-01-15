'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Combobox, type ComboboxOption, Input } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import {
  conditionsToJsonString,
  jsonStringToConditions,
} from '@/lib/table/filters/filter-builder-utils'
import type { FilterCondition } from '@/lib/table/filters/filter-constants'
import { useFilterBuilder } from '@/lib/table/filters/use-filter-builder'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { SubBlockInputController } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/sub-block-input-controller'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useAccessibleReferencePrefixes } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-accessible-reference-prefixes'

interface FilterFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: FilterCondition[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
  /** SubBlock ID for the mode dropdown (e.g., 'filterMode') - enables builder ↔ JSON sync */
  modeSubBlockId?: string
  /** SubBlock ID for the JSON filter field (e.g., 'filter') - target for JSON output */
  jsonSubBlockId?: string
}

/**
 * Visual builder for filter conditions with optional JSON sync.
 *
 * When `modeSubBlockId` and `jsonSubBlockId` are provided, this component handles
 * bidirectional conversion between builder conditions and JSON format:
 * - Builder → JSON: Conditions sync to JSON when modified in builder mode
 * - JSON → Builder: JSON parses to conditions when switching to builder mode
 */
export function FilterFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  columns: propColumns,
  tableIdSubBlockId = 'tableId',
  modeSubBlockId,
  jsonSubBlockId,
}: FilterFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<FilterCondition[]>(blockId, subBlockId)
  const [tableIdValue] = useSubBlockValue<string>(blockId, tableIdSubBlockId)
  const [dynamicColumns, setDynamicColumns] = useState<ComboboxOption[]>([])
  const fetchedTableIdRef = useRef<string | null>(null)

  // Mode sync state - only used when modeSubBlockId and jsonSubBlockId are provided
  const [modeValue] = useSubBlockValue<string>(blockId, modeSubBlockId || '_unused_mode')
  const [jsonValue, setJsonValue] = useSubBlockValue<string>(
    blockId,
    jsonSubBlockId || '_unused_json'
  )
  const prevModeRef = useRef<string | null>(null)
  const isSyncingRef = useRef(false)

  const accessiblePrefixes = useAccessibleReferencePrefixes(blockId)

  /**
   * Syncs JSON → Builder when mode switches to 'builder'.
   * Uses refs to prevent sync loops and only triggers on actual mode transitions.
   */
  useEffect(() => {
    if (!modeSubBlockId || !jsonSubBlockId || isPreview) return

    const switchingToBuilder =
      prevModeRef.current !== null && prevModeRef.current !== 'builder' && modeValue === 'builder'

    if (switchingToBuilder && jsonValue?.trim()) {
      isSyncingRef.current = true
      const conditions = jsonStringToConditions(jsonValue)
      if (conditions.length > 0) {
        setStoreValue(conditions)
      }
      isSyncingRef.current = false
    }

    prevModeRef.current = modeValue
  }, [modeValue, jsonValue, modeSubBlockId, jsonSubBlockId, setStoreValue, isPreview])

  /**
   * Syncs Builder → JSON when conditions change while in builder mode.
   * Skips sync when isSyncingRef is true to prevent loops.
   */
  useEffect(() => {
    if (!modeSubBlockId || !jsonSubBlockId || isPreview || isSyncingRef.current) return
    if (modeValue !== 'builder') return

    const conditions = Array.isArray(storeValue) ? storeValue : []
    if (conditions.length > 0) {
      const newJson = conditionsToJsonString(conditions)
      if (newJson !== jsonValue) {
        setJsonValue(newJson)
      }
    }
  }, [storeValue, modeValue, modeSubBlockId, jsonSubBlockId, jsonValue, setJsonValue, isPreview])

  /** Fetches table schema columns when tableId changes */
  useEffect(() => {
    const fetchColumns = async () => {
      if (!tableIdValue || tableIdValue === fetchedTableIdRef.current) return

      try {
        const { useWorkflowRegistry } = await import('@/stores/workflows/registry/store')
        const workspaceId = useWorkflowRegistry.getState().hydration.workspaceId
        if (!workspaceId) return

        const response = await fetch(`/api/table/${tableIdValue}?workspaceId=${workspaceId}`)
        if (!response.ok) return

        const result = await response.json()
        const cols = result.data?.table?.schema?.columns || result.table?.schema?.columns || []
        setDynamicColumns(
          cols.map((col: { name: string }) => ({ value: col.name, label: col.name }))
        )
        fetchedTableIdRef.current = tableIdValue
      } catch {
        // Silently fail - columns will be empty
      }
    }

    fetchColumns()
  }, [tableIdValue])

  const columns = useMemo(() => {
    if (propColumns && propColumns.length > 0) return propColumns
    return dynamicColumns
  }, [propColumns, dynamicColumns])

  const value = isPreview ? previewValue : storeValue
  const conditions: FilterCondition[] = Array.isArray(value) && value.length > 0 ? value : []
  const isReadOnly = isPreview || disabled

  // Use the shared filter builder hook for condition management
  const { comparisonOptions, logicalOptions, addCondition, removeCondition, updateCondition } =
    useFilterBuilder({
      columns,
      conditions,
      setConditions: setStoreValue,
      isReadOnly,
    })

  return (
    <div className='flex flex-col gap-[8px]'>
      {conditions.length === 0 ? (
        <div className='flex items-center justify-center rounded-[4px] border border-[var(--border-1)] border-dashed py-[16px]'>
          <Button variant='ghost' size='sm' onClick={addCondition} disabled={isReadOnly}>
            <Plus className='mr-[4px] h-[12px] w-[12px]' />
            Add filter condition
          </Button>
        </div>
      ) : (
        <>
          {conditions.map((condition, index) => (
            <div key={condition.id} className='flex items-center gap-[6px]'>
              {/* Remove Button */}
              <Button
                variant='ghost'
                size='sm'
                onClick={() => removeCondition(condition.id)}
                disabled={isReadOnly}
                className='h-[24px] w-[24px] shrink-0 p-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
              >
                <X className='h-[12px] w-[12px]' />
              </Button>

              {/* Logical Operator */}
              <div className='w-[80px] shrink-0'>
                {index === 0 ? (
                  <Combobox
                    size='sm'
                    options={[{ value: 'where', label: 'where' }]}
                    value='where'
                    disabled
                  />
                ) : (
                  <Combobox
                    size='sm'
                    options={logicalOptions}
                    value={condition.logicalOperator}
                    onChange={(v) =>
                      updateCondition(condition.id, 'logicalOperator', v as 'and' | 'or')
                    }
                    disabled={isReadOnly}
                  />
                )}
              </div>

              {/* Column Selector */}
              <div className='w-[100px] shrink-0'>
                <Combobox
                  size='sm'
                  options={columns}
                  value={condition.column}
                  onChange={(v) => updateCondition(condition.id, 'column', v)}
                  placeholder='Column'
                  disabled={isReadOnly}
                />
              </div>

              {/* Comparison Operator */}
              <div className='w-[110px] shrink-0'>
                <Combobox
                  size='sm'
                  options={comparisonOptions}
                  value={condition.operator}
                  onChange={(v) => updateCondition(condition.id, 'operator', v)}
                  disabled={isReadOnly}
                />
              </div>

              {/* Value Input with Tag Dropdown */}
              <div className='relative min-w-[80px] flex-1'>
                <SubBlockInputController
                  blockId={blockId}
                  subBlockId={`${subBlockId}_filter_${condition.id}`}
                  config={{ id: `filter_value_${condition.id}`, type: 'short-input' }}
                  value={condition.value}
                  onChange={(newValue) => updateCondition(condition.id, 'value', newValue)}
                  isPreview={isPreview}
                  disabled={disabled}
                >
                  {({ ref, value: ctrlValue, onChange, onKeyDown, onDrop, onDragOver }) => {
                    const formattedText = formatDisplayText(ctrlValue, {
                      accessiblePrefixes,
                      highlightAll: !accessiblePrefixes,
                    })

                    return (
                      <div className='relative'>
                        <Input
                          ref={ref as React.RefObject<HTMLInputElement>}
                          className='h-[28px] w-full overflow-auto text-[12px] text-transparent caret-foreground [-ms-overflow-style:none] [scrollbar-width:none] placeholder:text-muted-foreground/50 [&::-webkit-scrollbar]:hidden'
                          value={ctrlValue}
                          onChange={onChange as (e: React.ChangeEvent<HTMLInputElement>) => void}
                          onKeyDown={
                            onKeyDown as (e: React.KeyboardEvent<HTMLInputElement>) => void
                          }
                          onDrop={onDrop as (e: React.DragEvent<HTMLInputElement>) => void}
                          onDragOver={onDragOver as (e: React.DragEvent<HTMLInputElement>) => void}
                          placeholder='Value'
                          disabled={isReadOnly}
                          autoComplete='off'
                        />
                        <div
                          className={cn(
                            'pointer-events-none absolute inset-0 flex items-center overflow-x-auto bg-transparent px-[8px] py-[6px] font-medium font-sans text-[12px] text-foreground [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                            (isPreview || disabled) && 'opacity-50'
                          )}
                        >
                          <div className='min-w-fit whitespace-pre'>{formattedText}</div>
                        </div>
                      </div>
                    )
                  }}
                </SubBlockInputController>
              </div>
            </div>
          ))}

          {/* Add Button */}
          <Button
            variant='ghost'
            size='sm'
            onClick={addCondition}
            disabled={isReadOnly}
            className='self-start'
          >
            <Plus className='mr-[4px] h-[12px] w-[12px]' />
            Add condition
          </Button>
        </>
      )}
    </div>
  )
}
