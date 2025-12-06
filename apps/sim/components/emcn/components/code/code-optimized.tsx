'use client'

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { highlight, languages } from 'prismjs'
import { List, type RowComponentProps, useDynamicRowHeight, useListRef } from 'react-window'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import { cn } from '@/lib/core/utils/cn'
import { CODE_LINE_HEIGHT_PX, calculateGutterWidth } from './code'

/**
 * Virtualized code viewer for large outputs.
 * Uses react-window to render only visible lines, keeping DOM minimal.
 * Supports Prism syntax highlighting, line numbers, text wrapping, and search.
 *
 * @example
 * ```tsx
 * <VirtualizedCodeViewer
 *   code={JSON.stringify(data, null, 2)}
 *   showGutter
 *   language="json"
 *   wrapText
 *   searchQuery="error"
 *   currentMatchIndex={0}
 * />
 * ```
 */

/**
 * Props for the VirtualizedCodeViewer component.
 */
interface VirtualizedCodeViewerProps {
  /** Code content to display */
  code: string
  /** Whether to show line numbers gutter */
  showGutter?: boolean
  /** Language for syntax highlighting */
  language?: 'javascript' | 'json' | 'python'
  /** Additional CSS classes for the container */
  className?: string
  /** Left padding offset */
  paddingLeft?: number
  /** Inline styles for the gutter */
  gutterStyle?: React.CSSProperties
  /** Whether to wrap text */
  wrapText?: boolean
  /** Search query to highlight in the code */
  searchQuery?: string
  /** Index of the currently active match */
  currentMatchIndex?: number
  /** Callback when match count changes */
  onMatchCountChange?: (count: number) => void
  /** Ref for the content container */
  contentRef?: React.RefObject<HTMLDivElement | null>
}

interface HighlightedLine {
  lineNumber: number
  html: string
}

interface CodeRowProps {
  lines: HighlightedLine[]
  gutterWidth: number
  showGutter: boolean
  gutterStyle?: React.CSSProperties
  leftOffset: number
  wrapText: boolean
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countSearchMatches(code: string, searchQuery: string): number {
  if (!searchQuery.trim()) return 0
  const escaped = escapeRegex(searchQuery)
  const regex = new RegExp(escaped, 'gi')
  const matches = code.match(regex)
  return matches?.length ?? 0
}

function applySearchHighlightingToLine(
  html: string,
  searchQuery: string,
  currentMatchIndex: number,
  globalMatchOffset: number
): { html: string; matchesInLine: number } {
  if (!searchQuery.trim()) return { html, matchesInLine: 0 }

  const escaped = escapeRegex(searchQuery)
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = html.split(/(<[^>]+>)/g)
  let matchesInLine = 0

  const result = parts
    .map((part) => {
      if (part.startsWith('<') && part.endsWith('>')) {
        return part
      }
      return part.replace(regex, (match) => {
        const globalIndex = globalMatchOffset + matchesInLine
        const isCurrentMatch = globalIndex === currentMatchIndex
        matchesInLine++

        const bgClass = isCurrentMatch
          ? 'bg-[#F6AD55] text-[#1a1a1a] dark:bg-[#F6AD55] dark:text-[#1a1a1a]'
          : 'bg-[#FCD34D]/40 dark:bg-[#FCD34D]/30'

        return `<mark class="${bgClass} rounded-[2px]" data-search-match>${match}</mark>`
      })
    })
    .join('')

  return { html: result, matchesInLine }
}

function CodeRow({ index, style, ...props }: RowComponentProps<CodeRowProps>) {
  const { lines, gutterWidth, showGutter, gutterStyle, leftOffset, wrapText } = props
  const line = lines[index]

  return (
    <div style={style} className='flex' data-row-index={index}>
      {showGutter && (
        <div
          className='flex-shrink-0 select-none pr-0.5 text-right text-[var(--text-muted)] text-xs tabular-nums leading-[21px] dark:text-[#a8a8a8]'
          style={{ width: gutterWidth, marginLeft: leftOffset, ...gutterStyle }}
        >
          {line.lineNumber}
        </div>
      )}
      <pre
        className={cn(
          'm-0 flex-1 pr-2 pl-2 font-mono text-[13px] text-[var(--text-primary)] leading-[21px] dark:text-[#eeeeee]',
          wrapText ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
        )}
        dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }}
      />
    </div>
  )
}

export const VirtualizedCodeViewer = memo(function VirtualizedCodeViewer({
  code,
  showGutter = true,
  language = 'json',
  className,
  paddingLeft = 0,
  gutterStyle,
  wrapText = false,
  searchQuery,
  currentMatchIndex = 0,
  onMatchCountChange,
  contentRef,
}: VirtualizedCodeViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useListRef(null)
  const [containerHeight, setContainerHeight] = useState(400)

  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: CODE_LINE_HEIGHT_PX,
    key: wrapText ? 'wrap' : 'nowrap',
  })

  const matchCount = useMemo(() => countSearchMatches(code, searchQuery || ''), [code, searchQuery])

  useEffect(() => {
    onMatchCountChange?.(matchCount)
  }, [matchCount, onMatchCountChange])

  const lines = useMemo(() => code.split('\n'), [code])
  const lineCount = lines.length
  const gutterWidth = useMemo(() => calculateGutterWidth(lineCount), [lineCount])

  const highlightedLines = useMemo(() => {
    const lang = languages[language] || languages.javascript
    return lines.map((line, idx) => ({
      lineNumber: idx + 1,
      html: highlight(line, lang, language),
    }))
  }, [lines, language])

  const matchOffsets = useMemo(() => {
    if (!searchQuery?.trim()) return []
    const offsets: number[] = []
    let cumulative = 0
    const escaped = escapeRegex(searchQuery)
    const regex = new RegExp(escaped, 'gi')

    for (const line of lines) {
      offsets.push(cumulative)
      const matches = line.match(regex)
      cumulative += matches?.length ?? 0
    }
    return offsets
  }, [lines, searchQuery])

  const linesWithSearch = useMemo(() => {
    if (!searchQuery?.trim()) return highlightedLines

    return highlightedLines.map((line, idx) => {
      const { html } = applySearchHighlightingToLine(
        line.html,
        searchQuery,
        currentMatchIndex,
        matchOffsets[idx]
      )
      return { ...line, html }
    })
  }, [highlightedLines, searchQuery, currentMatchIndex, matchOffsets])

  useEffect(() => {
    if (!searchQuery?.trim() || matchCount === 0 || !listRef.current) return

    let accumulated = 0
    for (let i = 0; i < matchOffsets.length; i++) {
      const matchesInThisLine = (matchOffsets[i + 1] ?? matchCount) - matchOffsets[i]
      if (currentMatchIndex >= accumulated && currentMatchIndex < accumulated + matchesInThisLine) {
        listRef.current.scrollToRow({ index: i, align: 'center' })
        break
      }
      accumulated += matchesInThisLine
    }
  }, [currentMatchIndex, searchQuery, matchCount, matchOffsets, listRef])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const parent = container.parentElement
    if (!parent) return

    const updateHeight = () => {
      setContainerHeight(parent.clientHeight)
    }

    updateHeight()

    const resizeObserver = new ResizeObserver(updateHeight)
    resizeObserver.observe(parent)

    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    if (!wrapText) return

    const container = containerRef.current
    if (!container) return

    const rows = container.querySelectorAll('[data-row-index]')
    if (rows.length === 0) return

    return dynamicRowHeight.observeRowElements(rows)
  }, [wrapText, dynamicRowHeight, linesWithSearch])

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el
      if (contentRef && 'current' in contentRef) {
        contentRef.current = el
      }
    },
    [contentRef]
  )

  const rowProps = useMemo(
    () => ({
      lines: linesWithSearch,
      gutterWidth,
      showGutter,
      gutterStyle,
      leftOffset: paddingLeft,
      wrapText,
    }),
    [linesWithSearch, gutterWidth, showGutter, gutterStyle, paddingLeft, wrapText]
  )

  return (
    <div
      ref={setRefs}
      className={cn(
        'code-editor-theme relative rounded-[4px] border border-[var(--border-strong)]',
        'bg-[var(--surface-1)] font-medium font-mono text-sm',
        'dark:bg-[#1F1F1F]',
        className
      )}
      style={{ height: containerHeight }}
    >
      <List
        listRef={listRef}
        defaultHeight={containerHeight}
        rowCount={lineCount}
        rowHeight={wrapText ? dynamicRowHeight : CODE_LINE_HEIGHT_PX}
        rowComponent={CodeRow}
        rowProps={rowProps}
        overscanCount={5}
        className='overflow-x-auto'
      />
    </div>
  )
})
