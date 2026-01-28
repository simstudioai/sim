'use client'

import type React from 'react'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { List, type RowComponentProps, useListRef } from 'react-window'
import { Badge, ChevronDown } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

type ValueType = 'null' | 'undefined' | 'array' | 'string' | 'number' | 'boolean' | 'object'
type BadgeVariant = 'green' | 'blue' | 'orange' | 'purple' | 'gray' | 'red'

interface NodeEntry {
  key: string
  value: unknown
  path: string
}

/**
 * Search context for structured output tree.
 */
interface SearchContextValue {
  query: string
  pathToMatchIndices: Map<string, number[]>
}

const SearchContext = createContext<SearchContextValue | null>(null)

/**
 * Configuration for virtualized rendering.
 */
const CONFIG = {
  ROW_HEIGHT: 22,
  INDENT_PER_LEVEL: 12,
  BASE_PADDING: 20,
  MAX_SEARCH_DEPTH: 100,
  OVERSCAN_COUNT: 10,
  VIRTUALIZATION_THRESHOLD: 200,
} as const

const BADGE_VARIANTS: Record<ValueType, BadgeVariant> = {
  string: 'green',
  number: 'blue',
  boolean: 'orange',
  array: 'purple',
  null: 'gray',
  undefined: 'gray',
  object: 'gray',
} as const

/**
 * Styling constants matching the original non-virtualized implementation.
 */
const STYLES = {
  row: 'group flex min-h-[22px] cursor-pointer items-center gap-[6px] rounded-[8px] px-[6px] -mx-[6px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
  chevron:
    'h-[8px] w-[8px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-100 group-hover:text-[var(--text-primary)]',
  keyName:
    'font-medium text-[13px] text-[var(--text-primary)] group-hover:text-[var(--text-primary)]',
  badge: 'rounded-[4px] px-[4px] py-[0px] text-[11px]',
  summary: 'text-[12px] text-[var(--text-tertiary)]',
  indent:
    'mt-[2px] ml-[3px] flex min-w-0 flex-col gap-[2px] border-[var(--border)] border-l pl-[9px]',
  value: 'min-w-0 py-[2px] text-[13px] text-[var(--text-primary)]',
  emptyValue: 'py-[2px] text-[13px] text-[var(--text-tertiary)]',
  matchHighlight: 'bg-yellow-200/60 dark:bg-yellow-500/40',
  currentMatchHighlight: 'bg-orange-400',
} as const

const EMPTY_MATCH_INDICES: number[] = []

function getTypeLabel(value: unknown): ValueType {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value as ValueType
}

function formatPrimitive(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return String(value)
}

function isPrimitive(value: unknown): value is null | undefined | string | number | boolean {
  return value === null || value === undefined || typeof value !== 'object'
}

function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object' && value !== null) return Object.keys(value).length === 0
  return false
}

function extractErrorMessage(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof Error) return data.message
  if (typeof data === 'object' && data !== null && 'message' in data) {
    return String((data as { message: unknown }).message)
  }
  return JSON.stringify(data, null, 2)
}

function buildEntries(value: unknown, basePath: string): NodeEntry[] {
  if (Array.isArray(value)) {
    return value.map((item, i) => ({ key: String(i), value: item, path: `${basePath}[${i}]` }))
  }
  return Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
    key: k,
    value: v,
    path: `${basePath}.${k}`,
  }))
}

function getCollapsedSummary(value: unknown): string | null {
  if (Array.isArray(value)) {
    const len = value.length
    return `${len} item${len !== 1 ? 's' : ''}`
  }
  if (typeof value === 'object' && value !== null) {
    const count = Object.keys(value).length
    return `${count} key${count !== 1 ? 's' : ''}`
  }
  return null
}

function computeInitialPaths(data: unknown, isError: boolean): Set<string> {
  if (isError) return new Set(['root.error'])
  if (!data || typeof data !== 'object') return new Set()
  const entries = Array.isArray(data)
    ? data.map((_, i) => `root[${i}]`)
    : Object.keys(data).map((k) => `root.${k}`)
  return new Set(entries)
}

function getAncestorPaths(path: string): string[] {
  const ancestors: string[] = []
  let current = path

  while (current.includes('.') || current.includes('[')) {
    const splitPoint = Math.max(current.lastIndexOf('.'), current.lastIndexOf('['))
    if (splitPoint <= 0) break
    current = current.slice(0, splitPoint)
    if (current !== 'root') ancestors.push(current)
  }

  return ancestors
}

function findTextMatches(text: string, query: string): Array<[number, number]> {
  if (!query) return []

  const matches: Array<[number, number]> = []
  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase()
  let pos = 0

  while (pos < lowerText.length) {
    const idx = lowerText.indexOf(lowerQuery, pos)
    if (idx === -1) break
    matches.push([idx, idx + query.length])
    pos = idx + 1
  }

  return matches
}

function addPrimitiveMatches(value: unknown, path: string, query: string, matches: string[]): void {
  const text = formatPrimitive(value)
  const count = findTextMatches(text, query).length
  for (let i = 0; i < count; i++) {
    matches.push(path)
  }
}

function collectAllMatchPaths(data: unknown, query: string, basePath: string, depth = 0): string[] {
  if (!query || depth > CONFIG.MAX_SEARCH_DEPTH) return []

  const matches: string[] = []

  if (isPrimitive(data)) {
    addPrimitiveMatches(data, `${basePath}.value`, query, matches)
    return matches
  }

  for (const entry of buildEntries(data, basePath)) {
    if (isPrimitive(entry.value)) {
      addPrimitiveMatches(entry.value, entry.path, query, matches)
    } else {
      matches.push(...collectAllMatchPaths(entry.value, query, entry.path, depth + 1))
    }
  }

  return matches
}

function buildPathToIndicesMap(matchPaths: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  matchPaths.forEach((path, globalIndex) => {
    const existing = map.get(path)
    if (existing) {
      existing.push(globalIndex)
    } else {
      map.set(path, [globalIndex])
    }
  })
  return map
}

/**
 * Renders text with search highlights using segments.
 */
function renderHighlightedSegments(
  text: string,
  query: string,
  matchIndices: number[],
  currentMatchIndex: number,
  path: string
): React.ReactNode {
  if (!query || matchIndices.length === 0) return text

  const textMatches = findTextMatches(text, query)
  if (textMatches.length === 0) return text

  const segments: React.ReactNode[] = []
  let lastEnd = 0

  textMatches.forEach(([start, end], i) => {
    const globalIndex = matchIndices[i]
    const isCurrent = globalIndex === currentMatchIndex

    if (start > lastEnd) {
      segments.push(<span key={`t-${path}-${start}`}>{text.slice(lastEnd, start)}</span>)
    }

    segments.push(
      <mark
        key={`m-${path}-${start}`}
        data-search-match
        data-match-index={globalIndex}
        className={cn(
          'rounded-sm',
          isCurrent ? STYLES.currentMatchHighlight : STYLES.matchHighlight
        )}
      >
        {text.slice(start, end)}
      </mark>
    )
    lastEnd = end
  })

  if (lastEnd < text.length) {
    segments.push(<span key={`t-${path}-${lastEnd}`}>{text.slice(lastEnd)}</span>)
  }

  return <>{segments}</>
}

interface HighlightedTextProps {
  text: string
  matchIndices: number[]
  path: string
  currentMatchIndex: number
}

/**
 * Renders text with search highlights for non-virtualized mode.
 * Accepts currentMatchIndex as prop to ensure re-render when it changes.
 */
const HighlightedText = memo(function HighlightedText({
  text,
  matchIndices,
  path,
  currentMatchIndex,
}: HighlightedTextProps) {
  const searchContext = useContext(SearchContext)

  if (!searchContext || matchIndices.length === 0) return <>{text}</>

  return (
    <>
      {renderHighlightedSegments(text, searchContext.query, matchIndices, currentMatchIndex, path)}
    </>
  )
})

interface StructuredNodeProps {
  name: string
  value: unknown
  path: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  wrapText: boolean
  currentMatchIndex: number
  isError?: boolean
}

/**
 * Recursive node component for non-virtualized rendering.
 * Preserves exact original styling with border-left tree lines.
 */
const StructuredNode = memo(function StructuredNode({
  name,
  value,
  path,
  expandedPaths,
  onToggle,
  wrapText,
  currentMatchIndex,
  isError = false,
}: StructuredNodeProps) {
  const searchContext = useContext(SearchContext)
  const type = getTypeLabel(value)
  const isPrimitiveValue = isPrimitive(value)
  const isEmptyValue = !isPrimitiveValue && isEmpty(value)
  const isExpanded = expandedPaths.has(path)

  const handleToggle = useCallback(() => onToggle(path), [onToggle, path])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleToggle()
      }
    },
    [handleToggle]
  )

  const childEntries = useMemo(
    () => (isPrimitiveValue || isEmptyValue ? [] : buildEntries(value, path)),
    [value, isPrimitiveValue, isEmptyValue, path]
  )

  const collapsedSummary = useMemo(
    () => (isPrimitiveValue ? null : getCollapsedSummary(value)),
    [value, isPrimitiveValue]
  )

  const badgeVariant = isError ? 'red' : BADGE_VARIANTS[type]
  const valueText = isPrimitiveValue ? formatPrimitive(value) : ''
  const matchIndices = searchContext?.pathToMatchIndices.get(path) ?? EMPTY_MATCH_INDICES

  return (
    <div className='flex min-w-0 flex-col'>
      <div
        className={STYLES.row}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        role='button'
        tabIndex={0}
        aria-expanded={isExpanded}
      >
        <span className={cn(STYLES.keyName, isError && 'text-[var(--text-error)]')}>{name}</span>
        <Badge variant={badgeVariant} className={STYLES.badge}>
          {type}
        </Badge>
        {!isExpanded && collapsedSummary && (
          <span className={STYLES.summary}>{collapsedSummary}</span>
        )}
        <ChevronDown className={cn(STYLES.chevron, !isExpanded && '-rotate-90')} />
      </div>

      {isExpanded && (
        <div className={STYLES.indent}>
          {isPrimitiveValue ? (
            <div
              className={cn(
                STYLES.value,
                wrapText ? '[word-break:break-word]' : 'whitespace-nowrap'
              )}
            >
              <HighlightedText
                text={valueText}
                matchIndices={matchIndices}
                path={path}
                currentMatchIndex={currentMatchIndex}
              />
            </div>
          ) : isEmptyValue ? (
            <div className={STYLES.emptyValue}>{Array.isArray(value) ? '[]' : '{}'}</div>
          ) : (
            childEntries.map((entry) => (
              <StructuredNode
                key={entry.path}
                name={entry.key}
                value={entry.value}
                path={entry.path}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                wrapText={wrapText}
                currentMatchIndex={currentMatchIndex}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
})

/**
 * Flattened row for virtualization.
 */
interface FlatRow {
  path: string
  key: string
  value: unknown
  depth: number
  type: 'header' | 'value' | 'empty'
  valueType: ValueType
  isExpanded: boolean
  isError: boolean
  collapsedSummary: string | null
  displayText: string
  matchIndices: number[]
}

/**
 * Flattens the tree into rows for virtualization.
 */
function flattenTree(
  data: unknown,
  expandedPaths: Set<string>,
  pathToMatchIndices: Map<string, number[]>,
  isError: boolean
): FlatRow[] {
  const rows: FlatRow[] = []

  if (isError) {
    const errorText = extractErrorMessage(data)
    const isExpanded = expandedPaths.has('root.error')

    rows.push({
      path: 'root.error',
      key: 'error',
      value: errorText,
      depth: 0,
      type: 'header',
      valueType: 'string',
      isExpanded,
      isError: true,
      collapsedSummary: null,
      displayText: '',
      matchIndices: [],
    })

    if (isExpanded) {
      rows.push({
        path: 'root.error.value',
        key: '',
        value: errorText,
        depth: 1,
        type: 'value',
        valueType: 'string',
        isExpanded: false,
        isError: true,
        collapsedSummary: null,
        displayText: errorText,
        matchIndices: pathToMatchIndices.get('root.error') ?? [],
      })
    }

    return rows
  }

  function processNode(key: string, value: unknown, path: string, depth: number): void {
    const valueType = getTypeLabel(value)
    const isPrimitiveValue = isPrimitive(value)
    const isEmptyValue = !isPrimitiveValue && isEmpty(value)
    const isExpanded = expandedPaths.has(path)
    const collapsedSummary = isPrimitiveValue ? null : getCollapsedSummary(value)

    rows.push({
      path,
      key,
      value,
      depth,
      type: 'header',
      valueType,
      isExpanded,
      isError: false,
      collapsedSummary,
      displayText: '',
      matchIndices: [],
    })

    if (isExpanded) {
      if (isPrimitiveValue) {
        rows.push({
          path: `${path}.value`,
          key: '',
          value,
          depth: depth + 1,
          type: 'value',
          valueType,
          isExpanded: false,
          isError: false,
          collapsedSummary: null,
          displayText: formatPrimitive(value),
          matchIndices: pathToMatchIndices.get(path) ?? [],
        })
      } else if (isEmptyValue) {
        rows.push({
          path: `${path}.empty`,
          key: '',
          value,
          depth: depth + 1,
          type: 'empty',
          valueType,
          isExpanded: false,
          isError: false,
          collapsedSummary: null,
          displayText: Array.isArray(value) ? '[]' : '{}',
          matchIndices: [],
        })
      } else {
        for (const entry of buildEntries(value, path)) {
          processNode(entry.key, entry.value, entry.path, depth + 1)
        }
      }
    }
  }

  if (isPrimitive(data)) {
    processNode('value', data, 'root.value', 0)
  } else if (data && typeof data === 'object') {
    for (const entry of buildEntries(data, 'root')) {
      processNode(entry.key, entry.value, entry.path, 0)
    }
  }

  return rows
}

/**
 * Counts total visible rows for determining virtualization threshold.
 */
function countVisibleRows(data: unknown, expandedPaths: Set<string>, isError: boolean): number {
  if (isError) return expandedPaths.has('root.error') ? 2 : 1

  let count = 0

  function countNode(value: unknown, path: string): void {
    count++
    if (!expandedPaths.has(path)) return

    if (isPrimitive(value) || isEmpty(value)) {
      count++
    } else {
      for (const entry of buildEntries(value, path)) {
        countNode(entry.value, entry.path)
      }
    }
  }

  if (isPrimitive(data)) {
    countNode(data, 'root.value')
  } else if (data && typeof data === 'object') {
    for (const entry of buildEntries(data, 'root')) {
      countNode(entry.value, entry.path)
    }
  }

  return count
}

interface VirtualizedRowProps {
  rows: FlatRow[]
  onToggle: (path: string) => void
  wrapText: boolean
  searchQuery: string
  currentMatchIndex: number
}

/**
 * Virtualized row component for large data sets.
 */
function VirtualizedRow({ index, style, ...props }: RowComponentProps<VirtualizedRowProps>) {
  const { rows, onToggle, wrapText, searchQuery, currentMatchIndex } = props
  const row = rows[index]
  const paddingLeft = CONFIG.BASE_PADDING + row.depth * CONFIG.INDENT_PER_LEVEL

  if (row.type === 'header') {
    const badgeVariant = row.isError ? 'red' : BADGE_VARIANTS[row.valueType]

    return (
      <div style={{ ...style, paddingLeft }} data-row-index={index}>
        <div
          className={STYLES.row}
          onClick={() => onToggle(row.path)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onToggle(row.path)
            }
          }}
          role='button'
          tabIndex={0}
          aria-expanded={row.isExpanded}
        >
          <span className={cn(STYLES.keyName, row.isError && 'text-[var(--text-error)]')}>
            {row.key}
          </span>
          <Badge variant={badgeVariant} className={STYLES.badge}>
            {row.valueType}
          </Badge>
          {!row.isExpanded && row.collapsedSummary && (
            <span className={STYLES.summary}>{row.collapsedSummary}</span>
          )}
          <ChevronDown className={cn(STYLES.chevron, !row.isExpanded && '-rotate-90')} />
        </div>
      </div>
    )
  }

  if (row.type === 'empty') {
    return (
      <div style={{ ...style, paddingLeft }} data-row-index={index}>
        <div className={STYLES.emptyValue}>{row.displayText}</div>
      </div>
    )
  }

  return (
    <div style={{ ...style, paddingLeft }} data-row-index={index}>
      <div
        className={cn(
          STYLES.value,
          row.isError && 'text-[var(--text-error)]',
          wrapText ? '[word-break:break-word]' : 'whitespace-nowrap'
        )}
      >
        {renderHighlightedSegments(
          row.displayText,
          searchQuery,
          row.matchIndices,
          currentMatchIndex,
          row.path
        )}
      </div>
    </div>
  )
}

export interface StructuredOutputProps {
  data: unknown
  wrapText?: boolean
  isError?: boolean
  isRunning?: boolean
  className?: string
  searchQuery?: string
  currentMatchIndex?: number
  onMatchCountChange?: (count: number) => void
  contentRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * Renders structured data as nested collapsible blocks.
 * Uses virtualization for large data sets (>200 visible rows) while
 * preserving exact original styling for smaller data sets.
 */
export const StructuredOutput = memo(function StructuredOutput({
  data,
  wrapText = true,
  isError = false,
  isRunning = false,
  className,
  searchQuery,
  currentMatchIndex = 0,
  onMatchCountChange,
  contentRef,
}: StructuredOutputProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    computeInitialPaths(data, isError)
  )
  const prevDataRef = useRef(data)
  const prevIsErrorRef = useRef(isError)
  const internalRef = useRef<HTMLDivElement>(null)
  const listRef = useListRef(null)
  const [containerHeight, setContainerHeight] = useState(400)

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      ;(internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      if (contentRef) {
        ;(contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      }
    },
    [contentRef]
  )

  // Measure container height
  useEffect(() => {
    const container = internalRef.current?.parentElement
    if (!container) return

    const updateHeight = () => setContainerHeight(container.clientHeight)
    updateHeight()

    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  // Reset expanded paths when data changes
  useEffect(() => {
    if (prevDataRef.current !== data || prevIsErrorRef.current !== isError) {
      prevDataRef.current = data
      prevIsErrorRef.current = isError
      setExpandedPaths(computeInitialPaths(data, isError))
    }
  }, [data, isError])

  const allMatchPaths = useMemo(() => {
    if (!searchQuery) return []
    if (isError) {
      const errorText = extractErrorMessage(data)
      const count = findTextMatches(errorText, searchQuery).length
      return Array(count).fill('root.error') as string[]
    }
    return collectAllMatchPaths(data, searchQuery, 'root')
  }, [data, searchQuery, isError])

  useEffect(() => {
    onMatchCountChange?.(allMatchPaths.length)
  }, [allMatchPaths.length, onMatchCountChange])

  const pathToMatchIndices = useMemo(() => buildPathToIndicesMap(allMatchPaths), [allMatchPaths])

  // Auto-expand to current match
  useEffect(() => {
    if (
      allMatchPaths.length === 0 ||
      currentMatchIndex < 0 ||
      currentMatchIndex >= allMatchPaths.length
    ) {
      return
    }

    const currentPath = allMatchPaths[currentMatchIndex]
    const pathsToExpand = [currentPath, ...getAncestorPaths(currentPath)]

    setExpandedPaths((prev) => {
      if (pathsToExpand.every((p) => prev.has(p))) return prev
      const next = new Set(prev)
      pathsToExpand.forEach((p) => next.add(p))
      return next
    })
  }, [currentMatchIndex, allMatchPaths])

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const rootEntries = useMemo<NodeEntry[]>(() => {
    if (isPrimitive(data)) return [{ key: 'value', value: data, path: 'root.value' }]
    return buildEntries(data, 'root')
  }, [data])

  const searchContextValue = useMemo<SearchContextValue | null>(() => {
    if (!searchQuery) return null
    return { query: searchQuery, pathToMatchIndices }
  }, [searchQuery, pathToMatchIndices])

  const visibleRowCount = useMemo(
    () => countVisibleRows(data, expandedPaths, isError),
    [data, expandedPaths, isError]
  )
  const useVirtualization = visibleRowCount > CONFIG.VIRTUALIZATION_THRESHOLD

  const flatRows = useMemo(() => {
    if (!useVirtualization) return []
    return flattenTree(data, expandedPaths, pathToMatchIndices, isError)
  }, [data, expandedPaths, pathToMatchIndices, isError, useVirtualization])

  // Scroll to match (virtualized)
  useEffect(() => {
    if (!useVirtualization || allMatchPaths.length === 0 || !listRef.current) return

    const currentPath = allMatchPaths[currentMatchIndex]
    const targetPath = currentPath.endsWith('.value') ? currentPath : `${currentPath}.value`
    const rowIndex = flatRows.findIndex((r) => r.path === targetPath || r.path === currentPath)

    if (rowIndex !== -1) {
      listRef.current.scrollToRow({ index: rowIndex, align: 'center' })
    }
  }, [currentMatchIndex, allMatchPaths, flatRows, listRef, useVirtualization])

  // Scroll to match (non-virtualized)
  useEffect(() => {
    if (useVirtualization || allMatchPaths.length === 0) return

    const rafId = requestAnimationFrame(() => {
      const match = internalRef.current?.querySelector(
        `[data-match-index="${currentMatchIndex}"]`
      ) as HTMLElement | null
      match?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })

    return () => cancelAnimationFrame(rafId)
  }, [currentMatchIndex, allMatchPaths.length, expandedPaths, useVirtualization])

  const containerClass = cn('flex flex-col pl-[20px]', wrapText && 'overflow-x-hidden', className)
  const virtualizedContainerClass = cn('relative', wrapText && 'overflow-x-hidden', className)
  const listClass = wrapText ? 'overflow-x-hidden' : 'overflow-x-auto'

  // Running state
  if (isRunning && data === undefined) {
    return (
      <div ref={setContainerRef} className={containerClass}>
        <div className={STYLES.row}>
          <span className={STYLES.keyName}>running</span>
          <Badge variant='green' className={STYLES.badge}>
            Running
          </Badge>
        </div>
      </div>
    )
  }

  // Empty state
  if (rootEntries.length === 0 && !isError) {
    return (
      <div ref={setContainerRef} className={containerClass}>
        <span className={STYLES.emptyValue}>null</span>
      </div>
    )
  }

  // Virtualized rendering
  if (useVirtualization) {
    return (
      <div
        ref={setContainerRef}
        className={virtualizedContainerClass}
        style={{ height: containerHeight }}
      >
        <List
          listRef={listRef}
          defaultHeight={containerHeight}
          rowCount={flatRows.length}
          rowHeight={CONFIG.ROW_HEIGHT}
          rowComponent={VirtualizedRow}
          rowProps={{
            rows: flatRows,
            onToggle: handleToggle,
            wrapText,
            searchQuery: searchQuery ?? '',
            currentMatchIndex,
          }}
          overscanCount={CONFIG.OVERSCAN_COUNT}
          className={listClass}
        />
      </div>
    )
  }

  // Non-virtualized rendering (preserves exact original styling)
  if (isError) {
    return (
      <SearchContext.Provider value={searchContextValue}>
        <div ref={setContainerRef} className={containerClass}>
          <StructuredNode
            name='error'
            value={extractErrorMessage(data)}
            path='root.error'
            expandedPaths={expandedPaths}
            onToggle={handleToggle}
            wrapText={wrapText}
            currentMatchIndex={currentMatchIndex}
            isError
          />
        </div>
      </SearchContext.Provider>
    )
  }

  return (
    <SearchContext.Provider value={searchContextValue}>
      <div ref={setContainerRef} className={containerClass}>
        {rootEntries.map((entry) => (
          <StructuredNode
            key={entry.path}
            name={entry.key}
            value={entry.value}
            path={entry.path}
            expandedPaths={expandedPaths}
            onToggle={handleToggle}
            wrapText={wrapText}
            currentMatchIndex={currentMatchIndex}
          />
        ))}
      </div>
    </SearchContext.Provider>
  )
})
