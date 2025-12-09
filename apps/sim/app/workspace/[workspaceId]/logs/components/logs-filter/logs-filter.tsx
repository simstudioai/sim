'use client'

import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Combobox, type ComboboxOption } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getTriggerOptions } from '@/lib/logs/get-trigger-options'
import { type ParsedFilter, parseQuery } from '@/lib/logs/query-parser'
import { FILTER_DEFINITIONS } from '@/lib/logs/search-suggestions'
import { getBlock } from '@/blocks/registry'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'

const CORE_TRIGGER_TYPES = ['manual', 'api', 'schedule', 'chat', 'webhook']

/** Cache for color icon components to ensure stable references across renders */
const colorIconCache = new Map<string, React.ComponentType<{ className?: string }>>()

/**
 * Returns a memoized icon component for a given color.
 * Uses a cache to ensure the same color always returns the same component reference,
 * which prevents unnecessary React reconciliation.
 */
function getColorIcon(color: string): React.ComponentType<{ className?: string }> {
  const cached = colorIconCache.get(color)
  if (cached) return cached

  const ColorIcon = ({ className }: { className?: string }) => (
    <div
      className={cn(className, 'flex-shrink-0 rounded-[3px]')}
      style={{ backgroundColor: color, width: 10, height: 10 }}
    />
  )
  ColorIcon.displayName = `ColorIcon(${color})`
  colorIconCache.set(color, ColorIcon)
  return ColorIcon
}

/**
 * Returns a memoized trigger icon component for integration blocks.
 * Core trigger types (manual, api, schedule, chat, webhook) return undefined.
 */
function getTriggerIcon(
  triggerType: string
): React.ComponentType<{ className?: string }> | undefined {
  if (CORE_TRIGGER_TYPES.includes(triggerType)) return undefined

  const block = getBlock(triggerType)
  if (!block?.icon) return undefined

  const BlockIcon = block.icon
  const TriggerIcon = ({ className }: { className?: string }) => (
    <BlockIcon className={cn(className, 'flex-shrink-0')} style={{ width: 12, height: 12 }} />
  )
  TriggerIcon.displayName = `TriggerIcon(${triggerType})`
  return TriggerIcon
}

interface LogsFilterProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
}

export function LogsFilter({ searchQuery, setSearchQuery }: LogsFilterProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    level,
    setLevel,
    workflowIds,
    setWorkflowIds,
    folderIds,
    setFolderIds,
    triggers,
    setTriggers,
    timeRange,
    setTimeRange,
  } = useFilterStore()
  const folders = useFolderStore((state) => state.folders)

  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string; color: string }>>([])

  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const res = await fetch(`/api/workflows?workspaceId=${encodeURIComponent(workspaceId)}`)
        if (res.ok) {
          const body = await res.json()
          setWorkflows(Array.isArray(body?.data) ? body.data : [])
        }
      } catch {
        setWorkflows([])
      }
    }
    if (workspaceId) fetchWorkflows()
  }, [workspaceId])

  const folderList = useMemo(() => {
    return Object.values(folders).filter((f) => f.workspaceId === workspaceId)
  }, [folders, workspaceId])

  // Status filter
  const selectedStatuses = useMemo((): string[] => {
    if (level === 'all') return []
    if (level === 'error') return ['error']
    if (level === 'info') return ['info']
    return []
  }, [level])

  const statusOptions: ComboboxOption[] = useMemo(
    () => [
      { value: 'error', label: 'Error', icon: getColorIcon('var(--text-error)') },
      { value: 'info', label: 'Success', icon: getColorIcon('var(--terminal-status-info-color)') },
    ],
    []
  )

  const handleStatusChange = useCallback(
    (values: string[]) => {
      if (values.length === 0) {
        setLevel('all')
      } else if (values.length === 1) {
        setLevel(values[0] as 'error' | 'info')
      } else {
        setLevel('all')
      }
    },
    [setLevel]
  )

  const statusDisplayLabel = useMemo(() => {
    if (selectedStatuses.length === 0) return 'All statuses'
    if (selectedStatuses.length === 1) {
      const status = statusOptions.find((s) => s.value === selectedStatuses[0])
      return status?.label || '1 selected'
    }
    return `${selectedStatuses.length} selected`
  }, [selectedStatuses, statusOptions])

  const selectedStatusColor =
    selectedStatuses.length === 1
      ? selectedStatuses[0] === 'error'
        ? 'var(--text-error)'
        : 'var(--terminal-status-info-color)'
      : null

  // Workflow filter
  const workflowOptions: ComboboxOption[] = useMemo(
    () => workflows.map((w) => ({ value: w.id, label: w.name, icon: getColorIcon(w.color) })),
    [workflows]
  )

  const workflowDisplayLabel = useMemo(() => {
    if (workflowIds.length === 0) return 'All workflows'
    if (workflowIds.length === 1) {
      const workflow = workflows.find((w) => w.id === workflowIds[0])
      return workflow?.name || '1 selected'
    }
    return `${workflowIds.length} selected`
  }, [workflowIds, workflows])

  const selectedWorkflow =
    workflowIds.length === 1 ? workflows.find((w) => w.id === workflowIds[0]) : null

  // Folder filter
  const folderOptions: ComboboxOption[] = useMemo(
    () => folderList.map((f) => ({ value: f.id, label: f.name })),
    [folderList]
  )

  const folderDisplayLabel = useMemo(() => {
    if (folderIds.length === 0) return 'All folders'
    if (folderIds.length === 1) {
      const folder = folderList.find((f) => f.id === folderIds[0])
      return folder?.name || '1 selected'
    }
    return `${folderIds.length} selected`
  }, [folderIds, folderList])

  // Trigger filter
  const triggerOptions: ComboboxOption[] = useMemo(
    () =>
      getTriggerOptions().map((t) => ({
        value: t.value,
        label: t.label,
        icon: getTriggerIcon(t.value),
      })),
    []
  )

  const triggerDisplayLabel = useMemo(() => {
    if (triggers.length === 0) return 'All triggers'
    if (triggers.length === 1) {
      const trigger = triggerOptions.find((t) => t.value === triggers[0])
      return trigger?.label || '1 selected'
    }
    return `${triggers.length} selected`
  }, [triggers, triggerOptions])

  // Cost filter
  const costDef = FILTER_DEFINITIONS.find((f) => f.key === 'cost')
  const costOptions: ComboboxOption[] = useMemo(
    () => costDef?.options.map((opt) => ({ value: opt.value, label: opt.label })) || [],
    [costDef]
  )
  const selectedCosts = useMemo(() => extractFilterFromQuery(searchQuery, 'cost'), [searchQuery])

  const handleCostChange = useCallback(
    (values: string[]) => {
      const newQuery = updateQueryWithFilter(searchQuery, 'cost', values)
      setSearchQuery(newQuery)
    },
    [searchQuery, setSearchQuery]
  )

  const costDisplayLabel = useMemo(() => {
    if (selectedCosts.length === 0) return 'All costs'
    if (selectedCosts.length === 1) {
      const cost = costOptions.find((c) => c.value === selectedCosts[0])
      return cost?.label || '1 selected'
    }
    return `${selectedCosts.length} selected`
  }, [selectedCosts, costOptions])

  // Duration filter
  const durationDef = FILTER_DEFINITIONS.find((f) => f.key === 'duration')
  const durationOptions: ComboboxOption[] = useMemo(
    () => durationDef?.options.map((opt) => ({ value: opt.value, label: opt.label })) || [],
    [durationDef]
  )
  const selectedDurations = useMemo(
    () => extractFilterFromQuery(searchQuery, 'duration'),
    [searchQuery]
  )

  const handleDurationChange = useCallback(
    (values: string[]) => {
      const newQuery = updateQueryWithFilter(searchQuery, 'duration', values)
      setSearchQuery(newQuery)
    },
    [searchQuery, setSearchQuery]
  )

  const durationDisplayLabel = useMemo(() => {
    if (selectedDurations.length === 0) return 'All durations'
    if (selectedDurations.length === 1) {
      const duration = durationOptions.find((d) => d.value === selectedDurations[0])
      return duration?.label || '1 selected'
    }
    return `${selectedDurations.length} selected`
  }, [selectedDurations, durationOptions])

  // Timeline filter
  const timeRangeOptions: ComboboxOption[] = [
    { value: 'All time', label: 'All time' },
    { value: 'Past 30 minutes', label: 'Past 30 minutes' },
    { value: 'Past hour', label: 'Past hour' },
    { value: 'Past 6 hours', label: 'Past 6 hours' },
    { value: 'Past 12 hours', label: 'Past 12 hours' },
    { value: 'Past 24 hours', label: 'Past 24 hours' },
    { value: 'Past 3 days', label: 'Past 3 days' },
    { value: 'Past 7 days', label: 'Past 7 days' },
    { value: 'Past 14 days', label: 'Past 14 days' },
    { value: 'Past 30 days', label: 'Past 30 days' },
  ]

  return (
    <div className='w-[204px] flex-shrink-0 rounded-[6px] bg-[#242424] p-[10px]'>
      <div className='flex flex-col gap-[16px]'>
        {/* Status Filter */}
        <div className='flex flex-col gap-[8px]'>
          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Status</span>
          <Combobox
            options={statusOptions}
            multiSelect
            multiSelectValues={selectedStatuses}
            onMultiSelectChange={handleStatusChange}
            placeholder='All statuses'
            overlayContent={
              <span className='flex items-center gap-[8px] truncate text-[var(--text-primary)]'>
                {selectedStatusColor && (
                  <div
                    className='flex-shrink-0 rounded-[3px]'
                    style={{ backgroundColor: selectedStatusColor, width: 10, height: 10 }}
                  />
                )}
                <span className='truncate'>{statusDisplayLabel}</span>
              </span>
            }
            showAllOption
            allOptionLabel='All statuses'
            size='sm'
          />
        </div>

        {/* Workflow Filter */}
        <div className='flex flex-col gap-[8px]'>
          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Workflow</span>
          <Combobox
            options={workflowOptions}
            multiSelect
            multiSelectValues={workflowIds}
            onMultiSelectChange={setWorkflowIds}
            placeholder='All workflows'
            overlayContent={
              <span className='flex items-center gap-[8px] truncate text-[var(--text-primary)]'>
                {selectedWorkflow && (
                  <div
                    className='h-[10px] w-[10px] flex-shrink-0 rounded-[3px]'
                    style={{ backgroundColor: selectedWorkflow.color }}
                  />
                )}
                <span className='truncate'>{workflowDisplayLabel}</span>
              </span>
            }
            searchable
            searchPlaceholder='Search workflows...'
            showAllOption
            allOptionLabel='All workflows'
            size='sm'
          />
        </div>

        {/* Folder Filter */}
        <div className='flex flex-col gap-[8px]'>
          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Folder</span>
          <Combobox
            options={folderOptions}
            multiSelect
            multiSelectValues={folderIds}
            onMultiSelectChange={setFolderIds}
            placeholder='All folders'
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{folderDisplayLabel}</span>
            }
            searchable
            searchPlaceholder='Search folders...'
            showAllOption
            allOptionLabel='All folders'
            size='sm'
          />
        </div>

        {/* Trigger Filter */}
        <div className='flex flex-col gap-[8px]'>
          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Trigger</span>
          <Combobox
            options={triggerOptions}
            multiSelect
            multiSelectValues={triggers}
            onMultiSelectChange={setTriggers}
            placeholder='All triggers'
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{triggerDisplayLabel}</span>
            }
            searchable
            searchPlaceholder='Search triggers...'
            showAllOption
            allOptionLabel='All triggers'
            size='sm'
          />
        </div>

        {/* Cost Filter */}
        <div className='flex flex-col gap-[8px]'>
          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Cost</span>
          <Combobox
            options={costOptions}
            multiSelect
            multiSelectValues={selectedCosts}
            onMultiSelectChange={handleCostChange}
            placeholder='All costs'
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{costDisplayLabel}</span>
            }
            showAllOption
            allOptionLabel='All costs'
            size='sm'
          />
        </div>

        {/* Duration Filter */}
        <div className='flex flex-col gap-[8px]'>
          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Duration</span>
          <Combobox
            options={durationOptions}
            multiSelect
            multiSelectValues={selectedDurations}
            onMultiSelectChange={handleDurationChange}
            placeholder='All durations'
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{durationDisplayLabel}</span>
            }
            showAllOption
            allOptionLabel='All durations'
            size='sm'
          />
        </div>

        {/* Timeline Filter */}
        <div className='flex flex-col gap-[8px]'>
          <span className='font-medium text-[12px] text-[var(--text-tertiary)]'>Timeline</span>
          <Combobox
            options={timeRangeOptions}
            value={timeRange}
            onChange={(val) => setTimeRange(val as typeof timeRange)}
            placeholder='Select time range'
            size='sm'
          />
        </div>
      </div>
    </div>
  )
}

function extractFilterFromQuery(query: string, field: string): string[] {
  const parsed = parseQuery(query)
  return parsed.filters.filter((f) => f.field === field).map((f) => f.originalValue)
}

function updateQueryWithFilter(query: string, field: string, values: string[]): string {
  const parsed = parseQuery(query)
  const otherFilters = parsed.filters.filter((f) => f.field !== field)
  const filterStrings = otherFilters.map(
    (f: ParsedFilter) => `${f.field}:${f.operator !== '=' ? f.operator : ''}${f.originalValue}`
  )

  for (const value of values) {
    filterStrings.push(`${field}:${value}`)
  }

  const parts = [...filterStrings]
  if (parsed.textSearch) {
    parts.push(parsed.textSearch)
  }

  return parts.join(' ')
}

export default LogsFilter
