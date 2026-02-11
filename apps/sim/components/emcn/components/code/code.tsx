'use client'

import {
  Fragment,
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChevronRight } from 'lucide-react'
import { highlight, languages } from 'prismjs'
import { List, type RowComponentProps, useDynamicRowHeight, useListRef } from 'react-window'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import { cn } from '@/lib/core/utils/cn'
import './code.css'

/**
 * Re-export Prism.js highlighting utilities for use across the app.
 * Components can import these instead of importing from prismjs directly.
 */
export { highlight, languages }

/**
 * Code editor configuration and constants.
 * All code editors in the app should use these values for consistency.
 */
export const CODE_LINE_HEIGHT_PX = 21

/**
 * Gutter width values based on the number of digits in line numbers.
 * Provides consistent spacing across all code editors.
 */
const GUTTER_WIDTHS = [20, 20, 30, 38, 46, 54] as const

/**
 * Width of the collapse column in pixels.
 */
const COLLAPSE_COLUMN_WIDTH = 12

/**
 * Calculates the dynamic gutter width based on the number of lines.
 * @param lineCount - The total number of lines in the code
 * @returns The gutter width in pixels
 */
export function calculateGutterWidth(lineCount: number): number {
  const digits = String(lineCount).length
  return GUTTER_WIDTHS[Math.min(digits - 1, GUTTER_WIDTHS.length - 1)]
}

/**
 * Information about a collapsible region in code.
 */
interface CollapsibleRegion {
  /** Line index where the region starts (0-based) */
  startLine: number
  /** Line index where the region ends (0-based, inclusive) */
  endLine: number
  /** Type of collapsible region */
  type: 'block' | 'string'
}

/**
 * Minimum string length to be considered collapsible.
 */
const MIN_COLLAPSIBLE_STRING_LENGTH = 80

/**
 * Maximum length of truncated string preview when collapsed.
 */
const MAX_TRUNCATED_STRING_LENGTH = 30

/**
 * Regex to match a JSON string value (key: "value" pattern).
 * Pre-compiled for performance.
 */
const STRING_VALUE_REGEX = /:\s*"([^"\\]|\\.)*"[,]?\s*$/

/**
 * Finds collapsible regions in JSON code by matching braces and detecting long strings.
 * A region is collapsible if it spans multiple lines OR contains a long string value.
 * Properly handles braces inside JSON strings by tracking string boundaries with correct
 * escape sequence handling (counts consecutive backslashes to determine if quotes are escaped).
 *
 * @param lines - Array of code lines
 * @returns Map of start line index to CollapsibleRegion
 */
function findCollapsibleRegions(lines: string[]): Map<number, CollapsibleRegion> {
  const regions = new Map<number, CollapsibleRegion>()
  const stringRegions = new Map<number, CollapsibleRegion>()
  const stack: { char: '{' | '['; line: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Detect collapsible string values (long strings on a single line)
    const stringMatch = line.match(STRING_VALUE_REGEX)
    if (stringMatch) {
      const colonIdx = line.indexOf('":')
      if (colonIdx !== -1) {
        const valueStart = line.indexOf('"', colonIdx + 1)
        const valueEnd = line.lastIndexOf('"')
        if (valueStart !== -1 && valueEnd > valueStart) {
          const stringValue = line.slice(valueStart + 1, valueEnd)
          if (stringValue.length >= MIN_COLLAPSIBLE_STRING_LENGTH || stringValue.includes('\\n')) {
            // Store separately to avoid conflicts with block regions
            stringRegions.set(i, { startLine: i, endLine: i, type: 'string' })
          }
        }
      }
    }

    // Check for block regions, skipping characters inside strings
    let inString = false
    for (let j = 0; j < line.length; j++) {
      const char = line[j]

      // Toggle string state on unescaped quotes
      // Must count consecutive backslashes: odd = escaped quote, even = unescaped quote
      if (char === '"') {
        let backslashCount = 0
        let k = j - 1
        while (k >= 0 && line[k] === '\\') {
          backslashCount++
          k--
        }
        // Only toggle if quote is not escaped (even number of preceding backslashes)
        if (backslashCount % 2 === 0) {
          inString = !inString
        }
        continue
      }

      // Skip braces inside strings
      if (inString) continue

      if (char === '{' || char === '[') {
        stack.push({ char, line: i })
      } else if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '['
        if (stack.length > 0 && stack[stack.length - 1].char === expected) {
          const start = stack.pop()!
          if (i > start.line) {
            regions.set(start.line, {
              startLine: start.line,
              endLine: i,
              type: 'block',
            })
          }
        }
      }
    }
  }

  // Merge string regions only where no block region exists (block takes priority)
  for (const [lineIdx, region] of stringRegions) {
    if (!regions.has(lineIdx)) {
      regions.set(lineIdx, region)
    }
  }

  return regions
}

/**
 * Computes visible line indices based on collapsed regions.
 * Only block regions hide lines; string regions just truncate content.
 *
 * @param totalLines - Total number of lines
 * @param collapsedLines - Set of line indices that are collapsed (start lines of regions)
 * @param regions - Map of collapsible regions
 * @returns Sorted array of visible line indices
 */
function computeVisibleLineIndices(
  totalLines: number,
  collapsedLines: Set<number>,
  regions: Map<number, CollapsibleRegion>
): number[] {
  if (collapsedLines.size === 0) {
    return Array.from({ length: totalLines }, (_, i) => i)
  }

  // Build sorted list of hidden ranges (only for block regions, not string regions)
  const hiddenRanges: Array<{ start: number; end: number }> = []
  for (const startLine of collapsedLines) {
    const region = regions.get(startLine)
    if (region && region.type === 'block' && region.endLine > region.startLine + 1) {
      hiddenRanges.push({ start: region.startLine + 1, end: region.endLine - 1 })
    }
  }
  hiddenRanges.sort((a, b) => a.start - b.start)

  // Merge overlapping ranges
  const merged: Array<{ start: number; end: number }> = []
  for (const range of hiddenRanges) {
    if (merged.length === 0 || merged[merged.length - 1].end < range.start - 1) {
      merged.push(range)
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, range.end)
    }
  }

  // Build visible indices by skipping hidden ranges
  const visible: number[] = []
  let rangeIdx = 0
  for (let i = 0; i < totalLines; i++) {
    while (rangeIdx < merged.length && merged[rangeIdx].end < i) {
      rangeIdx++
    }
    if (rangeIdx < merged.length && i >= merged[rangeIdx].start && i <= merged[rangeIdx].end) {
      continue
    }
    visible.push(i)
  }

  return visible
}

/**
 * Truncates a long string value in a JSON line for collapsed display.
 *
 * @param line - The original line content
 * @returns Truncated line with ellipsis
 */
function truncateStringLine(line: string): string {
  const colonIdx = line.indexOf('":')
  if (colonIdx === -1) return line

  const valueStart = line.indexOf('"', colonIdx + 1)
  if (valueStart === -1) return line

  const prefix = line.slice(0, valueStart + 1)
  const suffix = line.charCodeAt(line.length - 1) === 44 /* ',' */ ? '",' : '"'
  const truncated = line.slice(valueStart + 1, valueStart + 1 + MAX_TRUNCATED_STRING_LENGTH)

  return `${prefix}${truncated}...${suffix}`
}

/**
 * Custom hook for managing JSON collapse state and computations.
 *
 * @param lines - Array of code lines
 * @param showCollapseColumn - Whether collapse functionality is enabled
 * @param language - Programming language for syntax detection
 * @returns Object containing collapse state and handlers
 */
function useJsonCollapse(
  lines: string[],
  showCollapseColumn: boolean,
  language: string
): {
  collapsedLines: Set<number>
  collapsibleLines: Set<number>
  collapsibleRegions: Map<number, CollapsibleRegion>
  collapsedStringLines: Set<number>
  visibleLineIndices: number[]
  toggleCollapse: (lineIndex: number) => void
} {
  const [collapsedLines, setCollapsedLines] = useState<Set<number>>(new Set())

  const collapsibleRegions = useMemo(() => {
    if (!showCollapseColumn || language !== 'json') return new Map<number, CollapsibleRegion>()
    return findCollapsibleRegions(lines)
  }, [lines, showCollapseColumn, language])

  const collapsibleLines = useMemo(() => new Set(collapsibleRegions.keys()), [collapsibleRegions])

  // Track which collapsed lines are string type (need truncation, not hiding)
  const collapsedStringLines = useMemo(() => {
    const stringLines = new Set<number>()
    for (const lineIdx of collapsedLines) {
      const region = collapsibleRegions.get(lineIdx)
      if (region?.type === 'string') {
        stringLines.add(lineIdx)
      }
    }
    return stringLines
  }, [collapsedLines, collapsibleRegions])

  const visibleLineIndices = useMemo(() => {
    if (!showCollapseColumn) {
      return Array.from({ length: lines.length }, (_, i) => i)
    }
    return computeVisibleLineIndices(lines.length, collapsedLines, collapsibleRegions)
  }, [lines.length, collapsedLines, collapsibleRegions, showCollapseColumn])

  const toggleCollapse = useCallback((lineIndex: number) => {
    setCollapsedLines((prev) => {
      const next = new Set(prev)
      if (next.has(lineIndex)) {
        next.delete(lineIndex)
      } else {
        next.add(lineIndex)
      }
      return next
    })
  }, [])

  return {
    collapsedLines,
    collapsibleLines,
    collapsibleRegions,
    collapsedStringLines,
    visibleLineIndices,
    toggleCollapse,
  }
}

/**
 * Props for the CollapseButton component.
 */
interface CollapseButtonProps {
  /** Whether the region is currently collapsed */
  isCollapsed: boolean
  /** Handler for toggle click */
  onClick: () => void
}

/**
 * Collapse/expand button with chevron icon.
 * Rotates chevron based on collapse state.
 */
const CollapseButton = memo(function CollapseButton({ isCollapsed, onClick }: CollapseButtonProps) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex h-[21px] w-[12px] cursor-pointer items-center justify-center border-none bg-transparent p-0 text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
      aria-label={isCollapsed ? 'Expand' : 'Collapse'}
    >
      <ChevronRight
        className={cn(
          '!h-[12px] !w-[12px] transition-transform duration-100',
          !isCollapsed && 'rotate-90'
        )}
      />
    </button>
  )
})

/**
 * Props for the Code.Container component.
 */
interface CodeContainerProps {
  /** Editor content wrapped by this container */
  children: ReactNode
  /** Additional CSS classes for the container */
  className?: string
  /** Inline styles for the container */
  style?: React.CSSProperties
  /** Drag and drop handler */
  onDragOver?: (e: React.DragEvent) => void
  /** Drop handler */
  onDrop?: (e: React.DragEvent) => void
}

/**
 * Code editor container that provides consistent styling across all editors.
 * Handles container chrome (border, radius, bg, font) with Tailwind.
 *
 * @example
 * ```tsx
 * <Code.Container>
 *   <Code.Content>
 *     <Editor {...props} />
 *   </Code.Content>
 * </Code.Container>
 * ```
 */
function Container({ children, className, style, onDragOver, onDrop }: CodeContainerProps) {
  return (
    <div
      className={cn(
        // Base container styling
        'group relative min-h-[100px] rounded-[4px] border border-[var(--border-1)]',
        'bg-[var(--surface-1)] font-medium font-mono text-sm transition-colors',
        'dark:bg-[#1F1F1F]',
        // Overflow handling for long content
        'overflow-x-auto overflow-y-auto',
        className
      )}
      style={style}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </div>
  )
}

/**
 * Props for Code.Content wrapper.
 */
interface CodeContentProps {
  /** Editor and related elements */
  children: ReactNode
  /** Padding left (e.g., for gutter offset) */
  paddingLeft?: string | number
  /** Additional CSS classes */
  className?: string
  /** Ref for the wrapper element */
  editorRef?: React.RefObject<HTMLDivElement | null>
}

/**
 * Wrapper for the editor content area that applies the code theme.
 * This enables VSCode-like token syntax highlighting via CSS.
 */
function Content({ children, paddingLeft, className, editorRef }: CodeContentProps) {
  return (
    <div
      ref={editorRef}
      className={cn('code-editor-theme relative mt-0 pt-0', className)}
      style={paddingLeft ? { paddingLeft } : undefined}
    >
      {children}
    </div>
  )
}

/**
 * Get standard Editor component props for react-simple-code-editor.
 * Returns the className and textareaClassName props (no style prop).
 *
 * @param options - Optional overrides
 * @returns Props object to spread onto Editor component
 */
export function getCodeEditorProps(options?: {
  isStreaming?: boolean
  isPreview?: boolean
  disabled?: boolean
}) {
  const { isStreaming = false, isPreview = false, disabled = false } = options || {}

  return {
    padding: 8,
    className: cn(
      // Base editor classes
      'bg-transparent font-[inherit] text-[inherit] font-medium',
      'text-[var(--text-primary)] dark:text-[#eeeeee]',
      'leading-[21px] outline-none focus:outline-none',
      'min-h-[106px]',
      // Streaming/disabled states
      (isStreaming || disabled) && 'cursor-not-allowed opacity-50'
    ),
    textareaClassName: cn(
      // Reset browser defaults
      'border-none bg-transparent outline-none resize-none',
      'focus:outline-none focus:ring-0',
      // Selection styling - light and dark modes
      'selection:bg-[#add6ff] selection:text-[#1b1b1b]',
      'dark:selection:bg-[#264f78] dark:selection:text-white',
      // Caret color - adapts to mode
      'caret-[var(--text-primary)] dark:caret-white',
      // Font smoothing
      '[-webkit-font-smoothing:antialiased] [-moz-osx-font-smoothing:grayscale]',
      // Disable interaction for streaming/preview/disabled
      (isStreaming || isPreview || disabled) && 'pointer-events-none'
    ),
  }
}

/**
 * Props for the Code.Gutter (line numbers) component.
 */
interface CodeGutterProps {
  /** Line number elements to render */
  children: ReactNode
  /** Width of the gutter in pixels */
  width: number
  /** Additional CSS classes */
  className?: string
  /** Inline styles */
  style?: React.CSSProperties
}

/**
 * Code editor gutter for line numbers.
 * Provides consistent styling for the line number column.
 */
function Gutter({ children, width, className, style }: CodeGutterProps) {
  return (
    <div
      className={cn(
        'absolute top-0 bottom-0 left-0',
        'flex select-none flex-col items-end overflow-hidden',
        'rounded-l-[4px] bg-[var(--surface-1)] dark:bg-[#1F1F1F]',
        'pr-0.5',
        className
      )}
      style={{ width: `${width}px`, paddingTop: '8.5px', ...style }}
      aria-hidden='true'
    >
      {children}
    </div>
  )
}

/**
 * Props for the Code.Placeholder component.
 */
interface CodePlaceholderProps {
  /** Placeholder text to display */
  children: ReactNode
  /** Width of the gutter (for proper left positioning) */
  gutterWidth: string | number
  /** Whether code editor has content */
  show: boolean
  /** Additional CSS classes */
  className?: string
}

/**
 * Code editor placeholder that appears when the editor is empty.
 * Automatically positioned to match the editor's text position.
 *
 * @example
 * ```tsx
 * <Code.Content paddingLeft={gutterWidth}>
 *   <Code.Placeholder gutterWidth={gutterWidth} show={code.length === 0}>
 *     Write your code here...
 *   </Code.Placeholder>
 *   <Editor {...props} />
 * </Code.Content>
 * ```
 */
function Placeholder({ children, gutterWidth, show, className }: CodePlaceholderProps) {
  if (!show) return null

  return (
    <pre
      className={cn(
        'pointer-events-none absolute select-none overflow-visible',
        'whitespace-pre-wrap text-muted-foreground/50',
        className
      )}
      style={{
        top: '8.5px',
        left: `calc(${typeof gutterWidth === 'number' ? `${gutterWidth}px` : gutterWidth} + 8px)`,
        fontFamily: 'inherit',
        margin: 0,
        lineHeight: `${CODE_LINE_HEIGHT_PX}px`,
      }}
    >
      {children}
    </pre>
  )
}

/**
 * Represents a highlighted line of code.
 */
interface HighlightedLine {
  /** 1-based line number */
  lineNumber: number
  /** Syntax-highlighted HTML content */
  html: string
}

/**
 * Props for virtualized row rendering.
 */
interface CodeRowProps {
  /** Array of highlighted lines to render */
  lines: HighlightedLine[]
  /** Width of the gutter in pixels */
  gutterWidth: number
  /** Whether to show the line number gutter */
  showGutter: boolean
  /** Custom styles for the gutter */
  gutterStyle?: React.CSSProperties
  /** Left offset for alignment */
  leftOffset: number
  /** Whether to wrap long lines */
  wrapText: boolean
  /** Whether to show the collapse column */
  showCollapseColumn: boolean
  /** Set of line indices that can be collapsed */
  collapsibleLines: Set<number>
  /** Set of line indices that are currently collapsed */
  collapsedLines: Set<number>
  /** Handler for toggling collapse state */
  onToggleCollapse: (lineIndex: number) => void
}

/**
 * Row component for virtualized code viewer.
 * Renders a single line with optional gutter and collapse button.
 */
function CodeRow({ index, style, ...props }: RowComponentProps<CodeRowProps>) {
  const {
    lines,
    gutterWidth,
    showGutter,
    gutterStyle,
    leftOffset,
    wrapText,
    showCollapseColumn,
    collapsibleLines,
    collapsedLines,
    onToggleCollapse,
  } = props
  const line = lines[index]
  const originalLineIndex = line.lineNumber - 1
  const isCollapsible = showCollapseColumn && collapsibleLines.has(originalLineIndex)
  const isCollapsed = collapsedLines.has(originalLineIndex)

  return (
    <div style={style} className={cn('flex', wrapText && 'overflow-hidden')} data-row-index={index}>
      {showGutter && (
        <div
          className='flex-shrink-0 select-none pr-0.5 text-right text-[var(--text-muted)] text-xs tabular-nums leading-[21px] dark:text-[#a8a8a8]'
          style={{ width: gutterWidth, marginLeft: leftOffset, ...gutterStyle }}
        >
          {line.lineNumber}
        </div>
      )}
      {showCollapseColumn && (
        <div
          className='ml-1 flex flex-shrink-0 items-start justify-end'
          style={{ width: COLLAPSE_COLUMN_WIDTH }}
        >
          {isCollapsible && (
            <CollapseButton
              isCollapsed={isCollapsed}
              onClick={() => onToggleCollapse(originalLineIndex)}
            />
          )}
        </div>
      )}
      <pre
        className={cn(
          'm-0 flex-1 pr-2 pl-2 font-mono text-[13px] text-[var(--text-primary)] leading-[21px] dark:text-[#eeeeee]',
          wrapText ? 'min-w-0 whitespace-pre-wrap break-words' : 'whitespace-pre'
        )}
        dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }}
      />
    </div>
  )
}

/**
 * Applies search highlighting to a single line for virtualized rendering.
 *
 * @param html - The syntax-highlighted HTML string
 * @param searchQuery - The search query to highlight
 * @param currentMatchIndex - Index of the current match (for distinct highlighting)
 * @param globalMatchOffset - Cumulative match count before this line
 * @returns Object containing highlighted HTML and count of matches in this line
 */
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

/**
 * Props for the Code.Viewer component (readonly code display).
 */
interface CodeViewerProps {
  /** Code content to display */
  code: string
  /** Whether to show line numbers gutter */
  showGutter?: boolean
  /** Language for syntax highlighting (default: 'json') */
  language?: 'javascript' | 'json' | 'python'
  /** Additional CSS classes for the container */
  className?: string
  /** Left padding offset (useful for terminal alignment) */
  paddingLeft?: number
  /** Inline styles for the gutter (e.g., to override background) */
  gutterStyle?: React.CSSProperties
  /** Whether to wrap text instead of using horizontal scroll */
  wrapText?: boolean
  /** Search query to highlight in the code */
  searchQuery?: string
  /** Index of the currently active match (for distinct highlighting) */
  currentMatchIndex?: number
  /** Callback when match count changes */
  onMatchCountChange?: (count: number) => void
  /** Ref for the content container (for scrolling to matches) */
  contentRef?: React.RefObject<HTMLDivElement | null>
  /** Enable virtualized rendering for large outputs (uses react-window) */
  virtualized?: boolean
  /** Whether to show a collapse column for JSON folding (only for json language) */
  showCollapseColumn?: boolean
}

/**
 * Escapes special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Applies search highlighting to already syntax-highlighted HTML.
 * Wraps matches in spans with appropriate highlighting classes.
 *
 * @param html - The syntax-highlighted HTML string
 * @param searchQuery - The search query to highlight
 * @param currentMatchIndex - Index of the current match (for distinct highlighting)
 * @param matchCounter - Mutable counter object to track match indices across calls
 * @returns The HTML with search highlighting applied
 */
function applySearchHighlighting(
  html: string,
  searchQuery: string,
  currentMatchIndex: number,
  matchCounter: { count: number }
): string {
  if (!searchQuery.trim()) return html

  const escaped = escapeRegex(searchQuery)
  const regex = new RegExp(`(${escaped})`, 'gi')

  // We need to be careful not to match inside HTML tags
  // Split by HTML tags and only process text parts
  const parts = html.split(/(<[^>]+>)/g)

  return parts
    .map((part) => {
      // If it's an HTML tag, don't modify it
      if (part.startsWith('<') && part.endsWith('>')) {
        return part
      }

      // Process text content
      return part.replace(regex, (match) => {
        const isCurrentMatch = matchCounter.count === currentMatchIndex
        matchCounter.count++

        const bgClass = isCurrentMatch
          ? 'bg-[#F6AD55] text-[#1a1a1a] dark:bg-[#F6AD55] dark:text-[#1a1a1a]'
          : 'bg-[#FCD34D]/40 dark:bg-[#FCD34D]/30'

        return `<mark class="${bgClass} rounded-[2px]" data-search-match>${match}</mark>`
      })
    })
    .join('')
}

/**
 * Props for inner viewer components (with defaults already applied).
 */
type ViewerInnerProps = {
  /** Code content to display */
  code: string
  /** Whether to show line numbers gutter */
  showGutter: boolean
  /** Language for syntax highlighting */
  language: 'javascript' | 'json' | 'python'
  /** Additional CSS classes for the container */
  className?: string
  /** Left padding offset in pixels */
  paddingLeft: number
  /** Custom styles for the gutter */
  gutterStyle?: React.CSSProperties
  /** Whether to wrap long lines */
  wrapText: boolean
  /** Search query to highlight */
  searchQuery?: string
  /** Index of the current active match */
  currentMatchIndex: number
  /** Callback when match count changes */
  onMatchCountChange?: (count: number) => void
  /** Ref for the content container */
  contentRef?: React.RefObject<HTMLDivElement | null>
  /** Whether to show collapse column for JSON folding */
  showCollapseColumn: boolean
}

/**
 * Virtualized code viewer implementation using react-window.
 * Optimized for large outputs with efficient scrolling and dynamic row heights.
 */
const VirtualizedViewerInner = memo(function VirtualizedViewerInner({
  code,
  showGutter,
  language,
  className,
  paddingLeft,
  gutterStyle,
  wrapText,
  searchQuery,
  currentMatchIndex,
  onMatchCountChange,
  contentRef,
  showCollapseColumn,
}: ViewerInnerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef = useListRef(null)
  const [containerHeight, setContainerHeight] = useState(400)

  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: CODE_LINE_HEIGHT_PX,
    key: wrapText ? 'wrap' : 'nowrap',
  })

  const lines = useMemo(() => code.split('\n'), [code])
  const gutterWidth = useMemo(() => calculateGutterWidth(lines.length), [lines.length])

  const {
    collapsedLines,
    collapsibleLines,
    collapsedStringLines,
    visibleLineIndices,
    toggleCollapse,
  } = useJsonCollapse(lines, showCollapseColumn, language)

  // Compute display lines (accounting for truncation of collapsed strings)
  const displayLines = useMemo(() => {
    return lines.map((line, idx) =>
      collapsedStringLines.has(idx) ? truncateStringLine(line) : line
    )
  }, [lines, collapsedStringLines])

  // Pre-compute cumulative match offsets based on DISPLAYED content (handles truncation)
  const { matchOffsets, matchCount } = useMemo(() => {
    if (!searchQuery?.trim()) return { matchOffsets: [], matchCount: 0 }

    const offsets: number[] = []
    let cumulative = 0
    const escaped = escapeRegex(searchQuery)
    const regex = new RegExp(escaped, 'gi')
    const visibleSet = new Set(visibleLineIndices)

    for (let i = 0; i < lines.length; i++) {
      offsets.push(cumulative)
      // Only count matches in visible lines, using displayed (possibly truncated) content
      if (visibleSet.has(i)) {
        const matches = displayLines[i].match(regex)
        cumulative += matches?.length ?? 0
      }
    }
    return { matchOffsets: offsets, matchCount: cumulative }
  }, [lines.length, displayLines, visibleLineIndices, searchQuery])

  useEffect(() => {
    onMatchCountChange?.(matchCount)
  }, [matchCount, onMatchCountChange])

  // Only process visible lines for efficiency (not all lines)
  const visibleLines = useMemo(() => {
    const lang = languages[language] || languages.javascript
    const hasSearch = searchQuery?.trim()

    return visibleLineIndices.map((idx) => {
      let html = highlight(displayLines[idx], lang, language)

      if (hasSearch && searchQuery) {
        const result = applySearchHighlightingToLine(
          html,
          searchQuery,
          currentMatchIndex,
          matchOffsets[idx]
        )
        html = result.html
      }

      return { lineNumber: idx + 1, html }
    })
  }, [displayLines, language, visibleLineIndices, searchQuery, currentMatchIndex, matchOffsets])

  useEffect(() => {
    if (!searchQuery?.trim() || matchCount === 0 || !listRef.current) return

    let accumulated = 0
    for (let i = 0; i < matchOffsets.length; i++) {
      const matchesInThisLine = (matchOffsets[i + 1] ?? matchCount) - matchOffsets[i]
      if (currentMatchIndex >= accumulated && currentMatchIndex < accumulated + matchesInThisLine) {
        const visibleIndex = visibleLineIndices.indexOf(i)
        if (visibleIndex !== -1) {
          listRef.current.scrollToRow({ index: visibleIndex, align: 'center' })
        }
        break
      }
      accumulated += matchesInThisLine
    }
  }, [currentMatchIndex, searchQuery, matchCount, matchOffsets, listRef, visibleLineIndices])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const parent = container.parentElement
    if (!parent) return

    const updateHeight = () => setContainerHeight(parent.clientHeight)
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
  }, [wrapText, dynamicRowHeight, visibleLines])

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      containerRef.current = el
      if (contentRef && 'current' in contentRef) {
        contentRef.current = el
      }
    },
    [contentRef]
  )

  const hasCollapsibleContent = collapsibleLines.size > 0
  const effectiveShowCollapseColumn = showCollapseColumn && hasCollapsibleContent

  const rowProps = useMemo(
    () => ({
      lines: visibleLines,
      gutterWidth,
      showGutter,
      gutterStyle,
      leftOffset: paddingLeft,
      wrapText,
      showCollapseColumn: effectiveShowCollapseColumn,
      collapsibleLines,
      collapsedLines,
      onToggleCollapse: toggleCollapse,
    }),
    [
      visibleLines,
      gutterWidth,
      showGutter,
      gutterStyle,
      paddingLeft,
      wrapText,
      effectiveShowCollapseColumn,
      collapsibleLines,
      collapsedLines,
      toggleCollapse,
    ]
  )

  return (
    <div
      ref={setRefs}
      className={cn(
        'code-editor-theme relative rounded-[4px] border border-[var(--border-1)]',
        'bg-[var(--surface-1)] font-medium font-mono text-sm',
        'dark:bg-[#1F1F1F]',
        className
      )}
      style={{ height: containerHeight }}
    >
      <List
        listRef={listRef}
        defaultHeight={containerHeight}
        rowCount={visibleLines.length}
        rowHeight={wrapText ? dynamicRowHeight : CODE_LINE_HEIGHT_PX}
        rowComponent={CodeRow}
        rowProps={rowProps}
        overscanCount={5}
        className={wrapText ? 'overflow-x-hidden' : 'overflow-x-auto'}
      />
    </div>
  )
})

/**
 * Non-virtualized code viewer implementation.
 * Renders all lines directly without windowing.
 */
function ViewerInner({
  code,
  showGutter,
  language,
  className,
  paddingLeft,
  gutterStyle,
  wrapText,
  searchQuery,
  currentMatchIndex,
  onMatchCountChange,
  contentRef,
  showCollapseColumn,
}: ViewerInnerProps) {
  const lines = useMemo(() => code.split('\n'), [code])
  const gutterWidth = useMemo(() => calculateGutterWidth(lines.length), [lines.length])

  const {
    collapsedLines,
    collapsibleLines,
    collapsedStringLines,
    visibleLineIndices,
    toggleCollapse,
  } = useJsonCollapse(lines, showCollapseColumn, language)

  // Compute display lines (accounting for truncation of collapsed strings)
  const displayLines = useMemo(() => {
    return lines.map((line, idx) =>
      collapsedStringLines.has(idx) ? truncateStringLine(line) : line
    )
  }, [lines, collapsedStringLines])

  // Pre-compute cumulative match offsets based on DISPLAYED content (handles truncation)
  const { cumulativeMatches, matchCount } = useMemo(() => {
    if (!searchQuery?.trim()) return { cumulativeMatches: [0], matchCount: 0 }

    const cumulative: number[] = [0]
    const escaped = escapeRegex(searchQuery)
    const regex = new RegExp(escaped, 'gi')
    const visibleSet = new Set(visibleLineIndices)

    for (let i = 0; i < lines.length; i++) {
      const prev = cumulative[cumulative.length - 1]
      // Only count matches in visible lines, using displayed content
      if (visibleSet.has(i)) {
        const matches = displayLines[i].match(regex)
        cumulative.push(prev + (matches?.length ?? 0))
      } else {
        cumulative.push(prev)
      }
    }
    return { cumulativeMatches: cumulative, matchCount: cumulative[cumulative.length - 1] }
  }, [lines.length, displayLines, visibleLineIndices, searchQuery])

  useEffect(() => {
    onMatchCountChange?.(matchCount)
  }, [matchCount, onMatchCountChange])

  // Pre-compute highlighted lines with search for visible indices (for gutter mode)
  const highlightedVisibleLines = useMemo(() => {
    const lang = languages[language] || languages.javascript

    if (!searchQuery?.trim()) {
      return visibleLineIndices.map((idx) => ({
        lineNumber: idx + 1,
        html: highlight(displayLines[idx], lang, language) || '&nbsp;',
      }))
    }

    return visibleLineIndices.map((idx) => {
      let html = highlight(displayLines[idx], lang, language)
      const matchCounter = { count: cumulativeMatches[idx] }
      html = applySearchHighlighting(html, searchQuery, currentMatchIndex, matchCounter)
      return { lineNumber: idx + 1, html: html || '&nbsp;' }
    })
  }, [
    displayLines,
    language,
    visibleLineIndices,
    searchQuery,
    currentMatchIndex,
    cumulativeMatches,
  ])

  // Pre-compute simple highlighted code (for no-gutter mode)
  const highlightedCode = useMemo(() => {
    const lang = languages[language] || languages.javascript
    const visibleCode = visibleLineIndices.map((idx) => displayLines[idx]).join('\n')
    let html = highlight(visibleCode, lang, language)

    if (searchQuery?.trim()) {
      const matchCounter = { count: 0 }
      html = applySearchHighlighting(html, searchQuery, currentMatchIndex, matchCounter)
    }
    return html
  }, [displayLines, language, visibleLineIndices, searchQuery, currentMatchIndex])

  const whitespaceClass = wrapText ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'

  const hasCollapsibleContent = collapsibleLines.size > 0
  const effectiveShowCollapseColumn = showCollapseColumn && hasCollapsibleContent
  const collapseColumnWidth = effectiveShowCollapseColumn ? COLLAPSE_COLUMN_WIDTH : 0

  // Grid-based rendering for gutter alignment (works with wrap)
  if (showGutter) {
    return (
      <Container className={className}>
        <Content className='code-editor-theme' editorRef={contentRef}>
          <div
            style={{
              paddingLeft,
              paddingTop: '8px',
              paddingBottom: '8px',
              display: 'grid',
              gridTemplateColumns: effectiveShowCollapseColumn
                ? `${gutterWidth}px ${collapseColumnWidth}px 1fr`
                : `${gutterWidth}px 1fr`,
            }}
          >
            {highlightedVisibleLines.map(({ lineNumber, html }) => {
              const idx = lineNumber - 1
              const isCollapsible = collapsibleLines.has(idx)
              const isCollapsed = collapsedLines.has(idx)

              return (
                <Fragment key={idx}>
                  <div
                    className='select-none pr-0.5 text-right text-[var(--text-muted)] text-xs tabular-nums leading-[21px] dark:text-[#a8a8a8]'
                    style={gutterStyle}
                  >
                    {lineNumber}
                  </div>
                  {effectiveShowCollapseColumn && (
                    <div className='ml-1 flex items-start justify-end'>
                      {isCollapsible && (
                        <CollapseButton
                          isCollapsed={isCollapsed}
                          onClick={() => toggleCollapse(idx)}
                        />
                      )}
                    </div>
                  )}
                  <pre
                    className={cn(
                      'm-0 min-w-0 pr-2 pl-2 font-mono text-[13px] text-[var(--text-primary)] leading-[21px] dark:text-[#eeeeee]',
                      whitespaceClass
                    )}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                </Fragment>
              )
            })}
          </div>
        </Content>
      </Container>
    )
  }

  // Simple display without gutter
  return (
    <Container className={className}>
      <Content className='code-editor-theme' editorRef={contentRef}>
        <pre
          className={cn(
            whitespaceClass,
            'p-2 font-mono text-[13px] text-[var(--text-primary)] leading-[21px] dark:text-[#eeeeee]'
          )}
          style={{ paddingLeft: paddingLeft > 0 ? paddingLeft : undefined }}
          dangerouslySetInnerHTML={{ __html: highlightedCode }}
        />
      </Content>
    </Container>
  )
}

/**
 * Readonly code viewer with optional gutter and syntax highlighting.
 * Routes to either standard or virtualized implementation based on the `virtualized` prop.
 *
 * @example
 * ```tsx
 * // Standard rendering
 * <Code.Viewer
 *   code={JSON.stringify(data, null, 2)}
 *   showGutter
 *   language="json"
 *   searchQuery="error"
 *   currentMatchIndex={0}
 * />
 *
 * // Virtualized rendering for large outputs
 * <Code.Viewer
 *   code={largeOutput}
 *   showGutter
 *   language="json"
 *   virtualized
 * />
 * ```
 */
function Viewer({
  code,
  showGutter = false,
  language = 'json',
  className,
  paddingLeft = 0,
  gutterStyle,
  wrapText = false,
  searchQuery,
  currentMatchIndex = 0,
  onMatchCountChange,
  contentRef,
  virtualized = false,
  showCollapseColumn = false,
}: CodeViewerProps) {
  const innerProps: ViewerInnerProps = {
    code,
    showGutter,
    language,
    className,
    paddingLeft,
    gutterStyle,
    wrapText,
    searchQuery,
    currentMatchIndex,
    onMatchCountChange,
    contentRef,
    showCollapseColumn,
  }

  return virtualized ? <VirtualizedViewerInner {...innerProps} /> : <ViewerInner {...innerProps} />
}

export const Code = {
  Container,
  Content,
  Gutter,
  Placeholder,
  Viewer,
}
