'use client'

import {
  createContext,
  memo,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Icon } from '@sim/emcn/icon'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { StatusTag } from '@sim/emcn/status'
import { useVirtualizer } from '@tanstack/react-virtual'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/structured-output/structured-output.module.css'
import {
  isLargeArrayManifest,
  isLargeValueRef,
  isUserFileDisplayMetadata,
  type LargeArrayManifest,
  type LargeValueRef,
} from '@/platform/lib/data/workflow-deploy/terminal'

type ValueType = 'null' | 'undefined' | 'array' | 'string' | 'number' | 'boolean' | 'object'

interface NodeEntry {
  key: string
  value: unknown
  path: string
}

interface SearchContextValue {
  query: string
  pathToMatchIndices: Map<string, number[]>
}

const SearchContext = createContext<SearchContextValue | null>(null)

const CONFIG = {
  ROW_HEIGHT: 30,
  MAX_SEARCH_DEPTH: 100,
  OVERSCAN_COUNT: 10,
  VIRTUALIZATION_THRESHOLD: 200,
} as const

const EMPTY_MATCH_INDICES: number[] = []
const USER_FILE_BASE64_PLACEHOLDER = '[TRUNCATED]'

function formatLargeValueSize(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getLargeValueDisplayValue(ref: LargeValueRef): unknown {
  return ref.preview ?? `[Large value: ${formatLargeValueSize(ref.size)}]`
}

function getLargeArrayManifestDisplayValue(manifest: LargeArrayManifest): unknown[] {
  const preview = manifest.preview
  if (manifest.totalCount <= preview.length) return preview
  const remaining = manifest.totalCount - preview.length
  return [...preview, `[... ${remaining.toLocaleString()} more item${remaining === 1 ? '' : 's'}]`]
}

function getDisplayValue(value: unknown): unknown {
  if (isLargeValueRef(value)) return getLargeValueDisplayValue(value)
  if (isLargeArrayManifest(value)) return getLargeArrayManifestDisplayValue(value)
  return value
}

function getTypeLabel(value: unknown): ValueType {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value as ValueType
}

function formatPrimitive(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
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
  const displayValue = getDisplayValue(value)
  if (Array.isArray(displayValue)) {
    return displayValue.map((item, i) => ({
      key: String(i),
      value: item,
      path: `${basePath}[${i}]`,
    }))
  }
  const entries = Object.entries(displayValue as Record<string, unknown>).map(([k, v]) => ({
    key: k,
    value: v,
    path: `${basePath}.${k}`,
  }))
  if (isUserFileDisplayMetadata(displayValue) && !('base64' in displayValue)) {
    entries.push({ key: 'base64', value: USER_FILE_BASE64_PLACEHOLDER, path: `${basePath}.base64` })
  }
  return entries
}

function getCollapsedSummary(value: unknown): string | null {
  const displayValue = getDisplayValue(value)
  if (Array.isArray(displayValue)) {
    return `${displayValue.length} item${displayValue.length !== 1 ? 's' : ''}`
  }
  if (typeof displayValue === 'object' && displayValue !== null) {
    const count = buildEntries(displayValue, '').length
    return `${count} key${count !== 1 ? 's' : ''}`
  }
  return null
}

function computeInitialPaths(data: unknown, isError: boolean): Set<string> {
  if (isError) return new Set(['root.error'])
  const displayData = getDisplayValue(data)
  if (!displayData || typeof displayData !== 'object') return new Set()
  return new Set(
    Array.isArray(displayData)
      ? displayData.map((_, i) => `root[${i}]`)
      : Object.keys(displayData).map((k) => `root.${k}`)
  )
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
  let position = 0
  while (position < lowerText.length) {
    const index = lowerText.indexOf(lowerQuery, position)
    if (index === -1) break
    matches.push([index, index + query.length])
    position = index + 1
  }
  return matches
}

function addPrimitiveMatches(value: unknown, path: string, query: string, matches: string[]) {
  const count = findTextMatches(formatPrimitive(value), query).length
  for (let i = 0; i < count; i++) matches.push(path)
}

function collectAllMatchPaths(data: unknown, query: string, basePath: string, depth = 0): string[] {
  if (!query || depth > CONFIG.MAX_SEARCH_DEPTH) return []
  const matches: string[] = []
  const displayData = getDisplayValue(data)
  if (isPrimitive(displayData)) {
    addPrimitiveMatches(displayData, `${basePath}.value`, query, matches)
    return matches
  }
  for (const entry of buildEntries(displayData, basePath)) {
    if (isPrimitive(entry.value)) addPrimitiveMatches(entry.value, entry.path, query, matches)
    else matches.push(...collectAllMatchPaths(entry.value, query, entry.path, depth + 1))
  }
  return matches
}

function buildPathToIndicesMap(matchPaths: string[]): Map<string, number[]> {
  const map = new Map<string, number[]>()
  matchPaths.forEach((path, globalIndex) => {
    const existing = map.get(path)
    if (existing) existing.push(globalIndex)
    else map.set(path, [globalIndex])
  })
  return map
}

function renderHighlightedSegments(
  text: string,
  query: string,
  matchIndices: number[],
  currentMatchIndex: number,
  path: string
): ReactNode {
  if (!query || matchIndices.length === 0) return text
  const textMatches = findTextMatches(text, query)
  if (textMatches.length === 0) return text

  const segments: ReactNode[] = []
  let lastEnd = 0
  textMatches.forEach(([start, end], i) => {
    const globalIndex = matchIndices[i]
    if (start > lastEnd)
      segments.push(<span key={`t-${path}-${start}`}>{text.slice(lastEnd, start)}</span>)
    segments.push(
      <mark
        key={`m-${path}-${start}`}
        className={styles.match}
        data-search-match
        data-match-index={globalIndex}
        data-current={globalIndex === currentMatchIndex || undefined}
      >
        {text.slice(start, end)}
      </mark>
    )
    lastEnd = end
  })
  if (lastEnd < text.length)
    segments.push(<span key={`t-${path}-${lastEnd}`}>{text.slice(lastEnd)}</span>)
  return segments
}

interface NodeHeaderProps {
  name: string
  type: ValueType
  isExpanded: boolean
  isError: boolean
  summary: string | null
  onToggle: () => void
}

/** A key's row: its name, its value type, a count while folded, and the disclosure chevron. */
function NodeHeader({ name, type, isExpanded, isError, summary, onToggle }: NodeHeaderProps) {
  return (
    <button type='button' className={styles.header} aria-expanded={isExpanded} onClick={onToggle}>
      <span className={styles.key} data-error={isError || undefined} data-type='T060'>
        {name}
      </span>
      <StatusTag label={type} intent={isError ? 'danger' : 'neutral'} />
      {!isExpanded && summary && (
        <span className={styles.summary} data-type='T060'>
          {summary}
        </span>
      )}
      <span className={styles.chevron}>
        <Icon name={isExpanded ? 'I051' : 'I090'} />
      </span>
    </button>
  )
}

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

/** A key and, while open, its value or children under the tree rule. */
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
  const displayValue = getDisplayValue(value)
  const type = getTypeLabel(displayValue)
  const isPrimitiveValue = isPrimitive(displayValue)
  const isEmptyValue = !isPrimitiveValue && isEmpty(displayValue)
  const isExpanded = expandedPaths.has(path)
  const handleToggle = useCallback(() => onToggle(path), [onToggle, path])
  const childEntries = useMemo(
    () => (isPrimitiveValue || isEmptyValue ? [] : buildEntries(displayValue, path)),
    [displayValue, isPrimitiveValue, isEmptyValue, path]
  )
  const summary = useMemo(
    () => (isPrimitiveValue ? null : getCollapsedSummary(displayValue)),
    [displayValue, isPrimitiveValue]
  )
  const matchIndices = searchContext?.pathToMatchIndices.get(path) ?? EMPTY_MATCH_INDICES

  return (
    <div className={styles.node}>
      <NodeHeader
        name={name}
        type={type}
        isExpanded={isExpanded}
        isError={isError}
        summary={summary}
        onToggle={handleToggle}
      />
      {isExpanded && (
        <div className={styles.children}>
          {isPrimitiveValue ? (
            <div
              className={styles.value}
              data-error={isError || undefined}
              data-wrap={wrapText || undefined}
              data-type='T060'
            >
              {searchContext
                ? renderHighlightedSegments(
                    formatPrimitive(displayValue),
                    searchContext.query,
                    matchIndices,
                    currentMatchIndex,
                    path
                  )
                : formatPrimitive(displayValue)}
            </div>
          ) : isEmptyValue ? (
            <div className={styles.empty} data-type='T060'>
              {Array.isArray(value) ? '[]' : '{}'}
            </div>
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

interface FlatRow {
  path: string
  key: string
  depth: number
  type: 'header' | 'value' | 'empty'
  valueType: ValueType
  isExpanded: boolean
  isError: boolean
  collapsedSummary: string | null
  displayText: string
  matchIndices: number[]
}

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

  function processNode(key: string, value: unknown, path: string, depth: number) {
    const displayValue = getDisplayValue(value)
    const valueType = getTypeLabel(displayValue)
    const isPrimitiveValue = isPrimitive(displayValue)
    const isEmptyValue = !isPrimitiveValue && isEmpty(displayValue)
    const isExpanded = expandedPaths.has(path)
    rows.push({
      path,
      key,
      depth,
      type: 'header',
      valueType,
      isExpanded,
      isError: false,
      collapsedSummary: isPrimitiveValue ? null : getCollapsedSummary(displayValue),
      displayText: '',
      matchIndices: [],
    })
    if (!isExpanded) return
    if (isPrimitiveValue) {
      rows.push({
        path: `${path}.value`,
        key: '',
        depth: depth + 1,
        type: 'value',
        valueType,
        isExpanded: false,
        isError: false,
        collapsedSummary: null,
        displayText: formatPrimitive(displayValue),
        matchIndices: pathToMatchIndices.get(path) ?? [],
      })
    } else if (isEmptyValue) {
      rows.push({
        path: `${path}.empty`,
        key: '',
        depth: depth + 1,
        type: 'empty',
        valueType,
        isExpanded: false,
        isError: false,
        collapsedSummary: null,
        displayText: Array.isArray(displayValue) ? '[]' : '{}',
        matchIndices: [],
      })
    } else {
      for (const entry of buildEntries(displayValue, path)) {
        processNode(entry.key, entry.value, entry.path, depth + 1)
      }
    }
  }

  const displayData = getDisplayValue(data)
  if (isPrimitive(displayData)) processNode('value', displayData, 'root.value', 0)
  else if (displayData && typeof displayData === 'object') {
    for (const entry of buildEntries(displayData, 'root')) {
      processNode(entry.key, entry.value, entry.path, 0)
    }
  }
  return rows
}

function countVisibleRows(data: unknown, expandedPaths: Set<string>, isError: boolean): number {
  if (isError) return expandedPaths.has('root.error') ? 2 : 1
  let count = 0
  function countNode(value: unknown, path: string) {
    const displayValue = getDisplayValue(value)
    count++
    if (!expandedPaths.has(path)) return
    if (isPrimitive(displayValue) || isEmpty(displayValue)) count++
    else for (const entry of buildEntries(displayValue, path)) countNode(entry.value, entry.path)
  }
  const displayData = getDisplayValue(data)
  if (isPrimitive(displayData)) countNode(displayData, 'root.value')
  else if (displayData && typeof displayData === 'object') {
    for (const entry of buildEntries(displayData, 'root')) countNode(entry.value, entry.path)
  }
  return count
}

/** Indents a flattened row by its depth, as the nested tree's rules would have. */
function indent(depth: number) {
  return (element: HTMLDivElement | null) => {
    element?.style.setProperty('padding-inline-start', `calc(var(--spacing-12) * ${depth})`)
  }
}

interface VirtualizedRowProps {
  row: FlatRow
  onToggle: (path: string) => void
  wrapText: boolean
  searchQuery: string
  currentMatchIndex: number
}

function VirtualizedRow({
  row,
  onToggle,
  wrapText,
  searchQuery,
  currentMatchIndex,
}: VirtualizedRowProps) {
  if (row.type === 'header') {
    return (
      <div ref={indent(row.depth)}>
        <NodeHeader
          name={row.key}
          type={row.valueType}
          isExpanded={row.isExpanded}
          isError={row.isError}
          summary={row.collapsedSummary}
          onToggle={() => onToggle(row.path)}
        />
      </div>
    )
  }
  if (row.type === 'empty') {
    return (
      <div ref={indent(row.depth)}>
        <div className={styles.empty} data-type='T060'>
          {row.displayText}
        </div>
      </div>
    )
  }
  return (
    <div ref={indent(row.depth)}>
      <div
        className={styles.value}
        data-error={row.isError || undefined}
        data-wrap={wrapText || undefined}
        data-type='T060'
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

interface StructuredOutputProps {
  data: unknown
  wrapText: boolean
  isError: boolean
  isRunning: boolean
  searchQuery: string | undefined
  currentMatchIndex: number
  onMatchCountChange: (count: number) => void
  /** Receives the scroll viewport, where the search hook finds the current match. */
  contentRef: RefObject<HTMLDivElement | null>
}

/**
 * A block's output as a tree of collapsible keys, each with its value type, opened one level deep.
 * Past 200 visible rows the tree flattens into a virtualized list. Search marks every match,
 * opens the branch holding the current one and scrolls it into view.
 */
export const StructuredOutput = memo(function StructuredOutput({
  data,
  wrapText,
  isError,
  isRunning,
  searchQuery,
  currentMatchIndex,
  onMatchCountChange,
  contentRef,
}: StructuredOutputProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    computeInitialPaths(data, isError)
  )
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const prevDataRef = useRef(data)
  const prevDataJsonRef = useRef<string | null>(null)
  const prevIsErrorRef = useRef(isError)

  const measureEdges = useScrollEdges<HTMLDivElement>()
  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      setViewport(element)
      contentRef.current = element
      return measureEdges(element)
    },
    [contentRef, measureEdges]
  )

  // A new output (not a re-render of the same value) opens at its first level again.
  useEffect(() => {
    if (prevIsErrorRef.current !== isError) {
      prevDataRef.current = data
      prevIsErrorRef.current = isError
      prevDataJsonRef.current = JSON.stringify(data)
      setExpandedPaths(computeInitialPaths(data, isError))
      return
    }
    if (prevDataRef.current !== data) {
      const nextJson = JSON.stringify(data)
      const prevJson = prevDataJsonRef.current ?? JSON.stringify(prevDataRef.current)
      if (prevJson !== nextJson) setExpandedPaths(computeInitialPaths(data, isError))
      prevDataJsonRef.current = nextJson
      prevDataRef.current = data
    }
  }, [data, isError])

  const allMatchPaths = useMemo(() => {
    if (!searchQuery) return []
    if (isError) {
      const count = findTextMatches(extractErrorMessage(data), searchQuery).length
      return Array<string>(count).fill('root.error')
    }
    return collectAllMatchPaths(data, searchQuery, 'root')
  }, [data, searchQuery, isError])

  useEffect(() => {
    onMatchCountChange(allMatchPaths.length)
  }, [allMatchPaths.length, onMatchCountChange])

  const pathToMatchIndices = useMemo(() => buildPathToIndicesMap(allMatchPaths), [allMatchPaths])

  useEffect(() => {
    if (currentMatchIndex < 0 || currentMatchIndex >= allMatchPaths.length) return
    const currentPath = allMatchPaths[currentMatchIndex]
    const pathsToExpand = [currentPath, ...getAncestorPaths(currentPath)]
    setExpandedPaths((previous) => {
      if (pathsToExpand.every((path) => previous.has(path))) return previous
      const next = new Set(previous)
      for (const path of pathsToExpand) next.add(path)
      return next
    })
  }, [currentMatchIndex, allMatchPaths])

  const handleToggle = useCallback((path: string) => {
    setExpandedPaths((previous) => {
      const next = new Set(previous)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  const rootEntries = useMemo<NodeEntry[]>(() => {
    const displayData = getDisplayValue(data)
    if (isPrimitive(displayData)) return [{ key: 'value', value: displayData, path: 'root.value' }]
    return buildEntries(displayData, 'root')
  }, [data])

  const searchContextValue = useMemo<SearchContextValue | null>(
    () => (searchQuery ? { query: searchQuery, pathToMatchIndices } : null),
    [searchQuery, pathToMatchIndices]
  )

  const visibleRowCount = useMemo(
    () => countVisibleRows(data, expandedPaths, isError),
    [data, expandedPaths, isError]
  )
  const virtualized = visibleRowCount > CONFIG.VIRTUALIZATION_THRESHOLD
  const flatRows = useMemo(
    () => (virtualized ? flattenTree(data, expandedPaths, pathToMatchIndices, isError) : []),
    [data, expandedPaths, pathToMatchIndices, isError, virtualized]
  )

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => viewport,
    estimateSize: () => CONFIG.ROW_HEIGHT,
    overscan: CONFIG.OVERSCAN_COUNT,
    useFlushSync: false,
  })

  useEffect(() => {
    if (!virtualized || allMatchPaths.length === 0) return
    const currentPath = allMatchPaths[currentMatchIndex]
    if (!currentPath) return
    const targetPath = currentPath.endsWith('.value') ? currentPath : `${currentPath}.value`
    const rowIndex = flatRows.findIndex(
      (row) => row.path === targetPath || row.path === currentPath
    )
    if (rowIndex !== -1) virtualizer.scrollToIndex(rowIndex, { align: 'center' })
  }, [currentMatchIndex, allMatchPaths, flatRows, virtualizer, virtualized])

  useEffect(() => {
    if (virtualized || allMatchPaths.length === 0 || !viewport) return
    const frame = requestAnimationFrame(() => {
      viewport
        .querySelector<HTMLElement>(`[data-match-index="${currentMatchIndex}"]`)
        ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => cancelAnimationFrame(frame)
  }, [currentMatchIndex, allMatchPaths.length, expandedPaths, virtualized, viewport])

  if (isRunning && data === undefined) {
    return (
      <div ref={setRefs} className={styles.tree}>
        <div className={styles.header}>
          <span className={styles.key} data-type='T060'>
            running
          </span>
          <StatusTag label='Running' intent='success' />
        </div>
      </div>
    )
  }

  if (rootEntries.length === 0 && !isError) {
    return (
      <div ref={setRefs} className={styles.tree}>
        <span className={styles.empty} data-type='T060'>
          null
        </span>
      </div>
    )
  }

  if (virtualized) {
    const items = virtualizer.getVirtualItems()
    const before = items[0]?.start ?? 0
    const after = Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0))
    return (
      <div ref={setRefs} className={styles.tree} data-wrap={wrapText || undefined}>
        {before > 0 && <Spacer blockSize={before} />}
        {items.map((item) => {
          const row = flatRows[item.index]
          if (!row) return null
          return (
            <div key={item.key} ref={virtualizer.measureElement} data-index={item.index}>
              <VirtualizedRow
                row={row}
                onToggle={handleToggle}
                wrapText={wrapText}
                searchQuery={searchQuery ?? ''}
                currentMatchIndex={currentMatchIndex}
              />
            </div>
          )
        })}
        {after > 0 && <Spacer blockSize={after} />}
      </div>
    )
  }

  return (
    <SearchContext.Provider value={searchContextValue}>
      <div ref={setRefs} className={styles.tree} data-wrap={wrapText || undefined}>
        {isError ? (
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
        ) : (
          rootEntries.map((entry) => (
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
          ))
        )}
      </div>
    </SearchContext.Provider>
  )
})

/** Stands in for the rows outside the window, keeping the viewport's full height. */
function Spacer({ blockSize }: { blockSize: number }) {
  return (
    <div
      aria-hidden='true'
      ref={(element) => {
        element?.style.setProperty('block-size', `${blockSize}px`)
      }}
    />
  )
}
