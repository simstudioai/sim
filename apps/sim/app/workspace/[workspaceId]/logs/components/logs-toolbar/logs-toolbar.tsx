'use client'

import { useCallback, useMemo, useState } from 'react'
import { ArrowUp, Bell, Library, MoreHorizontal, RefreshCw } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Combobox,
  type ComboboxOption,
  Loader,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverTrigger,
} from '@/components/emcn'
import { DatePicker } from '@/components/emcn/components/date-picker/date-picker'
import { cn } from '@/lib/core/utils/cn'
import { hasActiveFilters } from '@/lib/logs/filters'
import { getTriggerOptions } from '@/lib/logs/get-trigger-options'
import { type LogStatus, STATUS_CONFIG } from '@/app/workspace/[workspaceId]/logs/utils'
import { getBlock } from '@/blocks/registry'
import { useFolderStore } from '@/stores/folders/store'
import { useFilterStore } from '@/stores/logs/filters/store'
import { CORE_TRIGGER_TYPES } from '@/stores/logs/filters/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { AutocompleteSearch } from './components/search'

const TIME_RANGE_OPTIONS: ComboboxOption[] = [
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
  { value: 'Custom range', label: 'Custom range' },
] as const

/**
 * Formats a date string (YYYY-MM-DD) for display.
 */
function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr)
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ]
  return `${months[date.getMonth()]} ${date.getDate()}`
}

type ViewMode = 'logs' | 'dashboard'

interface LogsToolbarProps {
  /** Current view mode */
  viewMode: ViewMode
  /** Callback when view mode changes */
  onViewModeChange: (mode: ViewMode) => void
  /** Whether the refresh spinner is visible */
  isRefreshing: boolean
  /** Callback when refresh button is clicked */
  onRefresh: () => void
  /** Whether live mode is enabled */
  isLive: boolean
  /** Callback when live toggle is clicked */
  onToggleLive: () => void
  /** Whether export is in progress */
  isExporting: boolean
  /** Callback when export is triggered */
  onExport: () => void
  /** Whether user can edit (for export permissions) */
  canEdit: boolean
  /** Whether there are logs to export */
  hasLogs: boolean
  /** Callback when notification settings is clicked */
  onOpenNotificationSettings: () => void
  /** Search query value */
  searchQuery: string
  /** Callback when search query changes */
  onSearchQueryChange: (query: string) => void
  /** Callback when search open state changes */
  onSearchOpenChange: (open: boolean) => void
}

/** Cache for color icon components to ensure stable references across renders */
const colorIconCache = new Map<string, React.ComponentType<{ className?: string }>>()

/**
 * Returns a memoized icon component for a given color.
 * Uses a cache to ensure the same color always returns the same component reference,
 * which prevents unnecessary React reconciliation.
 * @param color - CSS color value for the icon background
 * @returns A React component that renders a colored square icon
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
 * @param triggerType - The trigger type identifier
 * @returns A React component that renders the trigger icon, or undefined for core types
 */
function getTriggerIcon(
  triggerType: string
): React.ComponentType<{ className?: string }> | undefined {
  if ((CORE_TRIGGER_TYPES as readonly string[]).includes(triggerType)) return undefined

  const block = getBlock(triggerType)
  if (!block?.icon) return undefined

  const BlockIcon = block.icon
  const TriggerIcon = ({ className }: { className?: string }) => (
    <BlockIcon className={cn(className, 'flex-shrink-0')} style={{ width: 12, height: 12 }} />
  )
  TriggerIcon.displayName = `TriggerIcon(${triggerType})`
  return TriggerIcon
}

/**
 * Consolidated logs toolbar component that combines header, search, and filters.
 * Contains title, icon, view mode toggle, refresh/live controls, search bar, and filter controls.
 * @param props - The component props
 * @returns The complete logs toolbar
 */
export function LogsToolbar({
  viewMode,
  onViewModeChange,
  isRefreshing,
  onRefresh,
  isLive,
  onToggleLive,
  isExporting,
  onExport,
  canEdit,
  hasLogs,
  onOpenNotificationSettings,
  searchQuery,
  onSearchQueryChange,
  onSearchOpenChange,
}: LogsToolbarProps) {
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
    startDate,
    endDate,
    setDateRange,
    clearDateRange,
    resetFilters,
  } = useFilterStore()

  const [datePickerOpen, setDatePickerOpen] = useState(false)
  const [previousTimeRange, setPreviousTimeRange] = useState(timeRange)
  const folders = useFolderStore((state) => state.folders)

  const allWorkflows = useWorkflowRegistry((state) => state.workflows)

  const workflows = useMemo(() => {
    return Object.values(allWorkflows).map((w) => ({
      id: w.id,
      name: w.name,
      color: w.color,
    }))
  }, [allWorkflows])

  const folderList = useMemo(() => {
    return Object.values(folders).filter((f) => f.workspaceId === workspaceId)
  }, [folders, workspaceId])

  const isDashboardView = viewMode === 'dashboard'

  const selectedStatuses = useMemo((): string[] => {
    if (level === 'all' || !level) return []
    return level.split(',').filter(Boolean)
  }, [level])

  const statusOptions: ComboboxOption[] = useMemo(
    () =>
      (Object.keys(STATUS_CONFIG) as LogStatus[]).map((status) => ({
        value: status,
        label: STATUS_CONFIG[status].label,
        icon: getColorIcon(STATUS_CONFIG[status].color),
      })),
    []
  )

  const handleStatusChange = useCallback(
    (values: string[]) => {
      if (values.length === 0) {
        setLevel('all')
      } else {
        setLevel(values.join(','))
      }
    },
    [setLevel]
  )

  const statusDisplayLabel = useMemo(() => {
    if (selectedStatuses.length === 0) return 'Status'
    if (selectedStatuses.length === 1) {
      const status = statusOptions.find((s) => s.value === selectedStatuses[0])
      return status?.label || '1 selected'
    }
    return `${selectedStatuses.length} selected`
  }, [selectedStatuses, statusOptions])

  const selectedStatusColor = useMemo(() => {
    if (selectedStatuses.length !== 1) return null
    const status = selectedStatuses[0] as LogStatus
    return STATUS_CONFIG[status]?.color ?? null
  }, [selectedStatuses])

  const workflowOptions: ComboboxOption[] = useMemo(
    () => workflows.map((w) => ({ value: w.id, label: w.name, icon: getColorIcon(w.color) })),
    [workflows]
  )

  const workflowDisplayLabel = useMemo(() => {
    if (workflowIds.length === 0) return 'Workflow'
    if (workflowIds.length === 1) {
      const workflow = workflows.find((w) => w.id === workflowIds[0])
      return workflow?.name || '1 selected'
    }
    return `${workflowIds.length} workflows`
  }, [workflowIds, workflows])

  const selectedWorkflow =
    workflowIds.length === 1 ? workflows.find((w) => w.id === workflowIds[0]) : null

  const folderOptions: ComboboxOption[] = useMemo(
    () => folderList.map((f) => ({ value: f.id, label: f.name })),
    [folderList]
  )

  const folderDisplayLabel = useMemo(() => {
    if (folderIds.length === 0) return 'Folder'
    if (folderIds.length === 1) {
      const folder = folderList.find((f) => f.id === folderIds[0])
      return folder?.name || '1 selected'
    }
    return `${folderIds.length} folders`
  }, [folderIds, folderList])

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
    if (triggers.length === 0) return 'Trigger'
    if (triggers.length === 1) {
      const trigger = triggerOptions.find((t) => t.value === triggers[0])
      return trigger?.label || '1 selected'
    }
    return `${triggers.length} triggers`
  }, [triggers, triggerOptions])

  const timeDisplayLabel = useMemo(() => {
    if (timeRange === 'All time') return 'Time'
    if (timeRange === 'Custom range' && startDate && endDate) {
      return `${formatDateShort(startDate)} - ${formatDateShort(endDate)}`
    }
    if (timeRange === 'Custom range') return 'Custom range'
    return timeRange
  }, [timeRange, startDate, endDate])

  /**
   * Handles time range selection from combobox.
   * Opens date picker when "Custom range" is selected.
   */
  const handleTimeRangeChange = useCallback(
    (val: string) => {
      if (val === 'Custom range') {
        setPreviousTimeRange(timeRange)
        setDatePickerOpen(true)
      } else {
        clearDateRange()
        setTimeRange(val as typeof timeRange)
      }
    },
    [timeRange, setTimeRange, clearDateRange]
  )

  /**
   * Handles date range selection from DatePicker.
   */
  const handleDateRangeApply = useCallback(
    (start: string, end: string) => {
      setDateRange(start, end)
      setDatePickerOpen(false)
    },
    [setDateRange]
  )

  /**
   * Handles date picker cancel.
   */
  const handleDatePickerCancel = useCallback(() => {
    if (timeRange === 'Custom range' && !startDate) {
      setTimeRange(previousTimeRange)
    }
    setDatePickerOpen(false)
  }, [timeRange, startDate, previousTimeRange, setTimeRange])

  const filtersActive = useMemo(
    () =>
      hasActiveFilters({
        timeRange,
        level,
        workflowIds,
        folderIds,
        triggers,
        searchQuery,
      }),
    [timeRange, level, workflowIds, folderIds, triggers, searchQuery]
  )

  const handleClearFilters = useCallback(() => {
    resetFilters()
    onSearchQueryChange('')
  }, [resetFilters, onSearchQueryChange])

  return (
    <div className='flex flex-col gap-[19px]'>
      {/* Header Section */}
      <div className='flex items-start justify-between'>
        <div className='flex items-start gap-[12px]'>
          <div className='flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#D4A843] bg-[#FDF6E3] dark:border-[#7A5F11] dark:bg-[#514215]'>
            <Library className='h-[14px] w-[14px] text-[#D4A843] dark:text-[#FBBC04]' />
          </div>
          <h1 className='font-medium text-[18px]'>Logs</h1>
        </div>
        <div className='flex items-center gap-[8px]'>
          {/* More options popover */}
          <Popover size='sm'>
            <PopoverTrigger asChild>
              <Button variant='default' className='h-[32px] w-[32px] rounded-[6px] p-0'>
                <MoreHorizontal className='h-[14px] w-[14px]' />
                <span className='sr-only'>More options</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' sideOffset={4}>
              <PopoverScrollArea>
                <PopoverItem onClick={onExport} disabled={!canEdit || isExporting || !hasLogs}>
                  <ArrowUp className='h-3 w-3' />
                  <span>Export as CSV</span>
                </PopoverItem>
                <PopoverItem onClick={onOpenNotificationSettings}>
                  <Bell className='h-3 w-3' />
                  <span>Configure Notifications</span>
                </PopoverItem>
              </PopoverScrollArea>
            </PopoverContent>
          </Popover>

          {/* Refresh button */}
          <Button
            variant='default'
            className='h-[32px] rounded-[6px] px-[10px]'
            onClick={isRefreshing ? undefined : onRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader className='h-[14px] w-[14px]' animate />
            ) : (
              <RefreshCw className='h-[14px] w-[14px]' />
            )}
          </Button>

          {/* Live button */}
          <Button
            variant={isLive ? 'tertiary' : 'default'}
            onClick={onToggleLive}
            className={cn(
              'h-[32px] rounded-[6px] px-[10px]',
              isLive && 'border border-[var(--brand-tertiary-2)]'
            )}
          >
            Live
          </Button>

          {/* View mode toggle */}
          <div
            className='flex h-[32px] cursor-pointer items-center rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] p-[2px]'
            onClick={() => onViewModeChange(isDashboardView ? 'logs' : 'dashboard')}
          >
            <Button
              variant={!isDashboardView ? 'active' : 'ghost'}
              className={cn(
                'h-[26px] rounded-[4px] px-[10px]',
                isDashboardView && 'border border-transparent'
              )}
            >
              Logs
            </Button>
            <Button
              variant={isDashboardView ? 'active' : 'ghost'}
              className={cn(
                'h-[26px] rounded-[4px] px-[10px]',
                !isDashboardView && 'border border-transparent'
              )}
            >
              Dashboard
            </Button>
          </div>
        </div>
      </div>

      {/* Filter Bar Section */}
      <div className='flex w-full items-center gap-[12px]'>
        <div className='min-w-[200px] max-w-[400px] flex-1'>
          <AutocompleteSearch
            value={searchQuery}
            onChange={onSearchQueryChange}
            placeholder='Search'
            onOpenChange={onSearchOpenChange}
          />
        </div>
        <div className='ml-auto flex items-center gap-[8px]'>
          {/* Clear Filters Button */}
          {filtersActive && (
            <Button
              variant='active'
              onClick={handleClearFilters}
              className='h-[32px] rounded-[6px] px-[10px]'
            >
              <span>Clear</span>
            </Button>
          )}

          {/* Filters Popover - Small screens only */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant='active'
                className='h-[32px] gap-[6px] rounded-[6px] px-[10px] xl:hidden'
              >
                <span>Filters</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align='end' sideOffset={4} className='w-[280px] p-[12px]'>
              <div className='flex flex-col gap-[12px]'>
                {/* Status Filter */}
                <div className='flex flex-col gap-[6px]'>
                  <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                    Status
                  </span>
                  <Combobox
                    options={statusOptions}
                    multiSelect
                    multiSelectValues={selectedStatuses}
                    onMultiSelectChange={handleStatusChange}
                    placeholder='All statuses'
                    overlayContent={
                      <span className='flex items-center gap-[6px] truncate text-[var(--text-primary)]'>
                        {selectedStatusColor && (
                          <div
                            className='flex-shrink-0 rounded-[3px]'
                            style={{ backgroundColor: selectedStatusColor, width: 8, height: 8 }}
                          />
                        )}
                        <span className='truncate'>{statusDisplayLabel}</span>
                      </span>
                    }
                    showAllOption
                    allOptionLabel='All statuses'
                    size='sm'
                    className='h-[32px] w-full rounded-[6px]'
                  />
                </div>

                {/* Workflow Filter */}
                <div className='flex flex-col gap-[6px]'>
                  <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                    Workflow
                  </span>
                  <Combobox
                    options={workflowOptions}
                    multiSelect
                    multiSelectValues={workflowIds}
                    onMultiSelectChange={setWorkflowIds}
                    placeholder='All workflows'
                    overlayContent={
                      <span className='flex items-center gap-[6px] truncate text-[var(--text-primary)]'>
                        {selectedWorkflow && (
                          <div
                            className='h-[8px] w-[8px] flex-shrink-0 rounded-[2px]'
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
                    className='h-[32px] w-full rounded-[6px]'
                  />
                </div>

                {/* Folder Filter */}
                <div className='flex flex-col gap-[6px]'>
                  <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                    Folder
                  </span>
                  <Combobox
                    options={folderOptions}
                    multiSelect
                    multiSelectValues={folderIds}
                    onMultiSelectChange={setFolderIds}
                    placeholder='All folders'
                    overlayContent={
                      <span className='truncate text-[var(--text-primary)]'>
                        {folderDisplayLabel}
                      </span>
                    }
                    searchable
                    searchPlaceholder='Search folders...'
                    showAllOption
                    allOptionLabel='All folders'
                    size='sm'
                    className='h-[32px] w-full rounded-[6px]'
                  />
                </div>

                {/* Trigger Filter */}
                <div className='flex flex-col gap-[6px]'>
                  <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                    Trigger
                  </span>
                  <Combobox
                    options={triggerOptions}
                    multiSelect
                    multiSelectValues={triggers}
                    onMultiSelectChange={setTriggers}
                    placeholder='All triggers'
                    overlayContent={
                      <span className='truncate text-[var(--text-primary)]'>
                        {triggerDisplayLabel}
                      </span>
                    }
                    searchable
                    searchPlaceholder='Search triggers...'
                    showAllOption
                    allOptionLabel='All triggers'
                    size='sm'
                    className='h-[32px] w-full rounded-[6px]'
                  />
                </div>

                {/* Time Filter */}
                <div className='flex flex-col gap-[6px]'>
                  <span className='font-medium text-[12px] text-[var(--text-secondary)]'>
                    Time Range
                  </span>
                  <Combobox
                    options={TIME_RANGE_OPTIONS as unknown as ComboboxOption[]}
                    value={timeRange}
                    onChange={handleTimeRangeChange}
                    placeholder='All time'
                    overlayContent={
                      <span className='truncate text-[var(--text-primary)]'>
                        {timeDisplayLabel}
                      </span>
                    }
                    size='sm'
                    className='h-[32px] w-full rounded-[6px]'
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Inline Filters - Large screens only */}
          <div className='hidden items-center gap-[8px] xl:flex'>
            {/* Status Filter */}
            <Combobox
              options={statusOptions}
              multiSelect
              multiSelectValues={selectedStatuses}
              onMultiSelectChange={handleStatusChange}
              placeholder='Status'
              overlayContent={
                <span className='flex items-center gap-[6px] truncate text-[var(--text-primary)]'>
                  {selectedStatusColor && (
                    <div
                      className='flex-shrink-0 rounded-[3px]'
                      style={{ backgroundColor: selectedStatusColor, width: 8, height: 8 }}
                    />
                  )}
                  <span className='truncate'>{statusDisplayLabel}</span>
                </span>
              }
              showAllOption
              allOptionLabel='All statuses'
              size='sm'
              align='end'
              className='h-[32px] w-[120px] rounded-[6px]'
            />

            {/* Workflow Filter */}
            <Combobox
              options={workflowOptions}
              multiSelect
              multiSelectValues={workflowIds}
              onMultiSelectChange={setWorkflowIds}
              placeholder='Workflow'
              overlayContent={
                <span className='flex items-center gap-[6px] truncate text-[var(--text-primary)]'>
                  {selectedWorkflow && (
                    <div
                      className='h-[8px] w-[8px] flex-shrink-0 rounded-[2px]'
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
              align='end'
              className='h-[32px] w-[120px] rounded-[6px]'
            />

            {/* Folder Filter */}
            <Combobox
              options={folderOptions}
              multiSelect
              multiSelectValues={folderIds}
              onMultiSelectChange={setFolderIds}
              placeholder='Folder'
              overlayContent={
                <span className='truncate text-[var(--text-primary)]'>{folderDisplayLabel}</span>
              }
              searchable
              searchPlaceholder='Search folders...'
              showAllOption
              allOptionLabel='All folders'
              size='sm'
              align='end'
              className='h-[32px] w-[120px] rounded-[6px]'
            />

            {/* Trigger Filter */}
            <Combobox
              options={triggerOptions}
              multiSelect
              multiSelectValues={triggers}
              onMultiSelectChange={setTriggers}
              placeholder='Trigger'
              overlayContent={
                <span className='truncate text-[var(--text-primary)]'>{triggerDisplayLabel}</span>
              }
              searchable
              searchPlaceholder='Search triggers...'
              showAllOption
              allOptionLabel='All triggers'
              size='sm'
              align='end'
              className='h-[32px] w-[120px] rounded-[6px]'
            />

            {/* Timeline Filter */}
            <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
              <PopoverAnchor asChild>
                <div>
                  <Combobox
                    options={TIME_RANGE_OPTIONS as unknown as ComboboxOption[]}
                    value={timeRange}
                    onChange={handleTimeRangeChange}
                    placeholder='Time'
                    overlayContent={
                      <span className='truncate text-[var(--text-primary)]'>
                        {timeDisplayLabel}
                      </span>
                    }
                    size='sm'
                    align='end'
                    className='h-[32px] w-[120px] rounded-[6px]'
                  />
                </div>
              </PopoverAnchor>
              <PopoverContent
                side='bottom'
                align='end'
                sideOffset={4}
                collisionPadding={16}
                className='w-auto p-0'
              >
                <DatePicker
                  mode='range'
                  startDate={startDate}
                  endDate={endDate}
                  onRangeChange={handleDateRangeApply}
                  onCancel={handleDatePickerCancel}
                  inline
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  )
}
