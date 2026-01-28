'use client'

import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'

type ValueType = 'null' | 'undefined' | 'array' | 'string' | 'number' | 'boolean' | 'object'
type BadgeVariant = 'green' | 'blue' | 'orange' | 'purple' | 'gray' | 'red'

interface NodeEntry {
  key: string
  value: unknown
  path: string
}

/** Search context passed through the component tree */
interface SearchContext {
  query: string
  currentMatchIndex: number
  pathToMatchIndices: Map<string, number[]>
}

const BADGE_VARIANTS: Record<ValueType, BadgeVariant> = {
  string: 'green',
  number: 'blue',
  boolean: 'orange',
  array: 'purple',
  null: 'gray',
  undefined: 'gray',
  object: 'gray',
} as const

const STYLES = {
  row: 'group flex min-h-[22px] cursor-pointer items-center gap-[6px] hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]',
  chevron:
    'h-[8px] w-[8px] flex-shrink-0 text-[var(--text-tertiary)] transition-transform duration-100 group-hover:text-[var(--text-primary)]',
  keyName:
    'font-medium text-[13px] text-[var(--text-secondary)] group-hover:text-[var(--text-primary)]',
  badge: 'rounded-[4px] px-[4px] py-[0px] font-mono text-[11px]',
  summary: 'font-mono text-[12px] text-[var(--text-tertiary)]',
  indent: 'ml-[3px] border-[var(--border)] border-l pl-[9px]',
  value: 'py-[2px] font-mono text-[13px] text-[var(--text-secondary)]',
  emptyValue: 'py-[2px] font-mono text-[13px] text-[var(--text-tertiary)]',
  matchHighlight: 'bg-yellow-200/60 dark:bg-yellow-500/40',
  currentMatchHighlight: 'bg-orange-400',
} as const

const EMPTY_MATCH_INDICES: number[] = []

/**
 * Returns the type label for a value
 * @param value - The value to get the type label for
 * @returns The type label string
 */
function getTypeLabel(value: unknown): ValueType {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (Array.isArray(value)) return 'array'
  return typeof value as ValueType
}

/**
 * Formats a primitive value for display
 * @param value - The primitive value to format
 * @returns The formatted string representation
 */
function formatPrimitive(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  return String(value)
}

/**
 * Checks if a value is a primitive (not object/array)
 * @param value - The value to check
 * @returns True if the value is a primitive
 */
function isPrimitive(value: unknown): value is null | undefined | string | number | boolean {
  return value === null || value === undefined || typeof value !== 'object'
}

/**
 * Checks if a value is an empty object or array
 * @param value - The value to check
 * @returns True if the value is empty
 */
function isEmpty(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object' && value !== null) return Object.keys(value).length === 0
  return false
}

/**
 * Extracts error message from various error data formats
 * @param data - The error data to extract message from
 * @returns The extracted error message string
 */
function extractErrorMessage(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof Error) return data.message
  if (typeof data === 'object' && data !== null && 'message' in data) {
    return String((data as { message: unknown }).message)
  }
  return JSON.stringify(data, null, 2)
}

/**
 * Builds node entries from an object or array value
 * @param value - The object or array to build entries from
 * @param basePath - The base path for constructing child paths
 * @returns Array of node entries
 */
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

/**
 * Gets the count summary for collapsed arrays/objects
 * @param value - The array or object to summarize
 * @returns Summary string or null for primitives
 */
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

/**
 * Computes initial expanded paths for first-level items
 * @param data - The data to compute paths for
 * @param isError - Whether this is error data
 * @returns Set of initially expanded paths
 */
function computeInitialPaths(data: unknown, isError: boolean): Set<string> {
  if (isError) return new Set(['root.error'])
  if (!data || typeof data !== 'object') return new Set()
  const entries = Array.isArray(data)
    ? data.map((_, i) => `root[${i}]`)
    : Object.keys(data).map((k) => `root.${k}`)
  return new Set(entries)
}

/**
 * Gets all ancestor paths needed to reach a given path
 * @param path - The target path
 * @returns Array of ancestor paths
 */
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

/**
 * Finds all case-insensitive matches of a query within text
 * @param text - The text to search in
 * @param query - The search query
 * @returns Array of [startIndex, endIndex] tuples
 */
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

/**
 * Adds match entries for a primitive value at the given path
 * @param value - The primitive value
 * @param path - The path to this value
 * @param query - The search query
 * @param matches - The matches array to add to
 */
function addPrimitiveMatches(value: unknown, path: string, query: string, matches: string[]): void {
  const text = formatPrimitive(value)
  const count = findTextMatches(text, query).length
  for (let i = 0; i < count; i++) {
    matches.push(path)
  }
}

/**
 * Recursively collects all match paths across the entire data tree
 * @param data - The data to search
 * @param query - The search query
 * @param basePath - The base path for this level
 * @returns Array of paths where matches were found
 */
function collectAllMatchPaths(data: unknown, query: string, basePath: string): string[] {
  if (!query) return []

  const matches: string[] = []

  if (isPrimitive(data)) {
    addPrimitiveMatches(data, `${basePath}.value`, query, matches)
    return matches
  }

  for (const entry of buildEntries(data, basePath)) {
    if (isPrimitive(entry.value)) {
      addPrimitiveMatches(entry.value, entry.path, query, matches)
    } else {
      matches.push(...collectAllMatchPaths(entry.value, query, entry.path))
    }
  }

  return matches
}

/**
 * Builds a map from path to array of global match indices
 * @param matchPaths - Array of paths where matches occur
 * @returns Map from path to array of global indices
 */
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

interface HighlightedTextProps {
  text: string
  searchQuery: string | undefined
  matchIndices: number[]
  currentMatchIndex: number
}

/**
 * Renders text with search highlights
 */
const HighlightedText = memo(function HighlightedText({
  text,
  searchQuery,
  matchIndices,
  currentMatchIndex,
}: HighlightedTextProps) {
  if (!searchQuery || matchIndices.length === 0) return <>{text}</>

  const textMatches = findTextMatches(text, searchQuery)
  if (textMatches.length === 0) return <>{text}</>

  const segments: React.ReactNode[] = []
  let lastEnd = 0

  textMatches.forEach(([start, end], i) => {
    const globalIndex = matchIndices[i]
    const isCurrent = globalIndex === currentMatchIndex

    if (start > lastEnd) {
      segments.push(<span key={`t-${start}`}>{text.slice(lastEnd, start)}</span>)
    }

    segments.push(
      <mark
        key={`m-${start}`}
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
    segments.push(<span key={`t-${lastEnd}`}>{text.slice(lastEnd)}</span>)
  }

  return <>{segments}</>
})

interface StructuredNodeProps {
  name: string
  value: unknown
  path: string
  expandedPaths: Set<string>
  onToggle: (path: string) => void
  wrapText: boolean
  isError?: boolean
  searchContext?: SearchContext
}

/**
 * Recursive node component for rendering structured data
 */
const StructuredNode = memo(function StructuredNode({
  name,
  value,
  path,
  expandedPaths,
  onToggle,
  wrapText,
  isError = false,
  searchContext,
}: StructuredNodeProps) {
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
        <ChevronDown className={cn(STYLES.chevron, !isExpanded && '-rotate-90')} />
        <span className={cn(STYLES.keyName, isError && 'text-[var(--text-error)]')}>{name}</span>
        <Badge variant={badgeVariant} className={STYLES.badge}>
          {type}
        </Badge>
        {!isExpanded && collapsedSummary && (
          <span className={STYLES.summary}>{collapsedSummary}</span>
        )}
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
                searchQuery={searchContext?.query}
                matchIndices={matchIndices}
                currentMatchIndex={searchContext?.currentMatchIndex ?? -1}
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
                searchContext={searchContext}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
})

interface StructuredOutputProps {
  data: unknown
  wrapText?: boolean
  isError?: boolean
  className?: string
  searchQuery?: string
  currentMatchIndex?: number
  onMatchCountChange?: (count: number) => void
  contentRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * Renders structured data as nested collapsible blocks.
 * Supports search with highlighting, auto-expand, and scroll-to-match.
 */
export const StructuredOutput = memo(function StructuredOutput({
  data,
  wrapText = true,
  isError = false,
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

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      ;(internalRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      if (contentRef) {
        ;(contentRef as React.MutableRefObject<HTMLDivElement | null>).current = node
      }
    },
    [contentRef]
  )

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

  useEffect(() => {
    if (allMatchPaths.length === 0) return

    const rafId = requestAnimationFrame(() => {
      const match = internalRef.current?.querySelector(
        `[data-match-index="${currentMatchIndex}"]`
      ) as HTMLElement | null
      match?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })

    return () => cancelAnimationFrame(rafId)
  }, [currentMatchIndex, allMatchPaths.length, expandedPaths])

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
    if (isPrimitive(data)) {
      return [{ key: 'value', value: data, path: 'root.value' }]
    }
    return buildEntries(data, 'root')
  }, [data])

  const searchContext = useMemo<SearchContext | undefined>(() => {
    if (!searchQuery) return undefined
    return { query: searchQuery, currentMatchIndex, pathToMatchIndices }
  }, [searchQuery, currentMatchIndex, pathToMatchIndices])

  const containerClass = cn('flex flex-col pl-[20px]', className)

  if (isError) {
    return (
      <div ref={setContainerRef} className={containerClass}>
        <StructuredNode
          name='error'
          value={extractErrorMessage(data)}
          path='root.error'
          expandedPaths={expandedPaths}
          onToggle={handleToggle}
          wrapText={wrapText}
          isError
          searchContext={searchContext}
        />
      </div>
    )
  }

  return (
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
          searchContext={searchContext}
        />
      ))}
    </div>
  )
})
