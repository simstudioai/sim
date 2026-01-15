'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button, Combobox, type ComboboxOption } from '@/components/emcn'
import {
  generateId,
  jsonStringToSortConditions,
  SORT_DIRECTIONS,
  type SortCondition,
  sortConditionsToJsonString,
} from '@/lib/table/filters/filter-builder-utils'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'

interface SortFormatProps {
  blockId: string
  subBlockId: string
  isPreview?: boolean
  previewValue?: SortCondition[] | null
  disabled?: boolean
  columns?: Array<{ value: string; label: string }>
  tableIdSubBlockId?: string
  /** SubBlock ID for the mode dropdown (e.g., 'sortMode') - enables builder ↔ JSON sync */
  modeSubBlockId?: string
  /** SubBlock ID for the JSON sort field (e.g., 'sort') - target for JSON output */
  jsonSubBlockId?: string
}

/**
 * Creates a new sort condition with default values
 */
const createDefaultCondition = (columns: ComboboxOption[]): SortCondition => ({
  id: generateId(),
  column: columns[0]?.value || '',
  direction: 'asc',
})

/**
 * Visual builder for sort conditions with optional JSON sync.
 *
 * When `modeSubBlockId` and `jsonSubBlockId` are provided, this component handles
 * bidirectional conversion between builder conditions and JSON format:
 * - Builder → JSON: Conditions sync to JSON when modified in builder mode
 * - JSON → Builder: JSON parses to conditions when switching to builder mode
 */
export function SortFormat({
  blockId,
  subBlockId,
  isPreview = false,
  previewValue,
  disabled = false,
  columns: propColumns,
  tableIdSubBlockId = 'tableId',
  modeSubBlockId,
  jsonSubBlockId,
}: SortFormatProps) {
  const [storeValue, setStoreValue] = useSubBlockValue<SortCondition[]>(blockId, subBlockId)
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
      const conditions = jsonStringToSortConditions(jsonValue)
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
      const newJson = sortConditionsToJsonString(conditions)
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
        const builtInCols = [
          { value: 'createdAt', label: 'createdAt' },
          { value: 'updatedAt', label: 'updatedAt' },
        ]
        const schemaCols = cols.map((col: { name: string }) => ({
          value: col.name,
          label: col.name,
        }))
        setDynamicColumns([...schemaCols, ...builtInCols])
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

  const directionOptions = useMemo(
    () => SORT_DIRECTIONS.map((dir) => ({ value: dir.value, label: dir.label })),
    []
  )

  const value = isPreview ? previewValue : storeValue
  const conditions: SortCondition[] = Array.isArray(value) && value.length > 0 ? value : []
  const isReadOnly = isPreview || disabled

  const addCondition = useCallback(() => {
    if (isReadOnly) return
    setStoreValue([...conditions, createDefaultCondition(columns)])
  }, [isReadOnly, conditions, columns, setStoreValue])

  const removeCondition = useCallback(
    (id: string) => {
      if (isReadOnly) return
      setStoreValue(conditions.filter((c) => c.id !== id))
    },
    [isReadOnly, conditions, setStoreValue]
  )

  const updateCondition = useCallback(
    (id: string, field: keyof SortCondition, newValue: string) => {
      if (isReadOnly) return
      setStoreValue(conditions.map((c) => (c.id === id ? { ...c, [field]: newValue } : c)))
    },
    [isReadOnly, conditions, setStoreValue]
  )

  return (
    <div className='flex flex-col gap-[8px]'>
      {conditions.length === 0 ? (
        <div className='flex items-center justify-center rounded-[4px] border border-[var(--border-1)] border-dashed py-[16px]'>
          <Button variant='ghost' size='sm' onClick={addCondition} disabled={isReadOnly}>
            <Plus className='mr-[4px] h-[12px] w-[12px]' />
            Add sort condition
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

              {/* Order indicator */}
              <div className='w-[90px] shrink-0'>
                <Combobox
                  size='sm'
                  options={[
                    { value: String(index + 1), label: index === 0 ? 'order by' : `then by` },
                  ]}
                  value={String(index + 1)}
                  disabled
                />
              </div>

              {/* Column Selector */}
              <div className='min-w-[120px] flex-1'>
                <Combobox
                  size='sm'
                  options={columns}
                  value={condition.column}
                  onChange={(v) => updateCondition(condition.id, 'column', v)}
                  placeholder='Column'
                  disabled={isReadOnly}
                />
              </div>

              {/* Direction Selector */}
              <div className='w-[110px] shrink-0'>
                <Combobox
                  size='sm'
                  options={directionOptions}
                  value={condition.direction}
                  onChange={(v) => updateCondition(condition.id, 'direction', v as 'asc' | 'desc')}
                  disabled={isReadOnly}
                />
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
            Add sort
          </Button>
        </>
      )}
    </div>
  )
}
