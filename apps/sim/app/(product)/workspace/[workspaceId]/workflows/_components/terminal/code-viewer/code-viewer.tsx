'use client'

import { type RefObject, useCallback, useEffect, useMemo, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { escapeRegExp } from '@sim/utils/string'
import { useVirtualizer } from '@tanstack/react-virtual'
import Prism from 'prismjs'
import 'prismjs/components/prism-python'
import 'prismjs/components/prism-json'
import 'prismjs/components/prism-bash'
import styles from '@/app/(product)/workspace/[workspaceId]/workflows/_components/terminal/code-viewer/code-viewer.module.css'

/** A language the terminal's code view highlights. */
export type CodeViewerLanguage = 'javascript' | 'json' | 'python' | 'bash'

/** One line in the T014 role. Wrapped lines are measured as they render. */
const LINE_HEIGHT = 20
const OVERSCAN = 5
/** A string shorter than this stays on its line; a longer one (or one with newlines) can fold. */
const MIN_COLLAPSIBLE_STRING_LENGTH = 80
const MAX_TRUNCATED_STRING_LENGTH = 30
const STRING_VALUE_REGEX = /:\s*"([^"\\]|\\.)*"[,]?\s*$/

interface CollapsibleRegion {
  startLine: number
  endLine: number
  type: 'block' | 'string'
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Prism markup for one line, token classes moved to `data-token` for the module's palette. The
 * full `prismjs` build and its core build each claim `window.Prism`, and a grammar registers on
 * whichever held it when its component loaded, so both are asked before falling back to text.
 */
function highlightLine(line: string, language: CodeViewerLanguage): string {
  const shared = (globalThis as { Prism?: typeof Prism }).Prism
  const grammar = Prism.languages[language] ?? shared?.languages[language]
  if (!grammar) return escapeHtml(line)
  return Prism.highlight(line, grammar, language).replace(
    /class="token ([^"]*)"/g,
    (_, kinds: string) => `data-token="${kinds}"`
  )
}

/**
 * Brace pairs spanning lines, and long string values, keyed by their first line. Quotes are tracked
 * with escape counting so braces inside strings never pair.
 */
function findCollapsibleRegions(lines: string[]): Map<number, CollapsibleRegion> {
  const regions = new Map<number, CollapsibleRegion>()
  const stringRegions = new Map<number, CollapsibleRegion>()
  const stack: { char: '{' | '['; line: number }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (STRING_VALUE_REGEX.test(line)) {
      const colonIdx = line.indexOf('":')
      if (colonIdx !== -1) {
        const valueStart = line.indexOf('"', colonIdx + 1)
        const valueEnd = line.lastIndexOf('"')
        if (valueStart !== -1 && valueEnd > valueStart) {
          const value = line.slice(valueStart + 1, valueEnd)
          if (value.length >= MIN_COLLAPSIBLE_STRING_LENGTH || value.includes('\\n')) {
            stringRegions.set(i, { startLine: i, endLine: i, type: 'string' })
          }
        }
      }
    }

    let inString = false
    for (let j = 0; j < line.length; j++) {
      const char = line[j]
      if (char === '"') {
        let backslashes = 0
        for (let k = j - 1; k >= 0 && line[k] === '\\'; k--) backslashes++
        if (backslashes % 2 === 0) inString = !inString
        continue
      }
      if (inString) continue
      if (char === '{' || char === '[') {
        stack.push({ char, line: i })
      } else if (char === '}' || char === ']') {
        const expected = char === '}' ? '{' : '['
        const open = stack.at(-1)
        if (open?.char === expected) {
          stack.pop()
          if (i > open.line)
            regions.set(open.line, { startLine: open.line, endLine: i, type: 'block' })
        }
      }
    }
  }

  for (const [lineIndex, region] of stringRegions) {
    if (!regions.has(lineIndex)) regions.set(lineIndex, region)
  }
  return regions
}

/** Lines left after folding the collapsed block regions; a folded string only truncates. */
function computeVisibleLineIndices(
  totalLines: number,
  collapsedLines: Set<number>,
  regions: Map<number, CollapsibleRegion>
): number[] {
  if (collapsedLines.size === 0) return Array.from({ length: totalLines }, (_, i) => i)

  const hidden: { start: number; end: number }[] = []
  for (const startLine of collapsedLines) {
    const region = regions.get(startLine)
    if (region?.type === 'block' && region.endLine > region.startLine + 1) {
      hidden.push({ start: region.startLine + 1, end: region.endLine - 1 })
    }
  }
  hidden.sort((a, b) => a.start - b.start)

  const merged: { start: number; end: number }[] = []
  for (const range of hidden) {
    const last = merged.at(-1)
    if (!last || last.end < range.start - 1) merged.push({ ...range })
    else last.end = Math.max(last.end, range.end)
  }

  const visible: number[] = []
  let rangeIndex = 0
  for (let i = 0; i < totalLines; i++) {
    while (rangeIndex < merged.length && merged[rangeIndex].end < i) rangeIndex++
    const range = merged[rangeIndex]
    if (range && i >= range.start && i <= range.end) continue
    visible.push(i)
  }
  return visible
}

function truncateStringLine(line: string): string {
  const colonIdx = line.indexOf('":')
  if (colonIdx === -1) return line
  const valueStart = line.indexOf('"', colonIdx + 1)
  if (valueStart === -1) return line
  const prefix = line.slice(0, valueStart + 1)
  const suffix = line.endsWith(',') ? '",' : '"'
  return `${prefix}${line.slice(valueStart + 1, valueStart + 1 + MAX_TRUNCATED_STRING_LENGTH)}...${suffix}`
}

/** Marks each search match in highlighted markup, numbering them from `offset` across lines. */
function markMatches(
  html: string,
  query: string,
  currentMatchIndex: number,
  offset: number
): string {
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi')
  let found = 0
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (part.startsWith('<') && part.endsWith('>')) return part
      return part.replace(regex, (match) => {
        const current = offset + found === currentMatchIndex
        found++
        return `<mark data-search-match${current ? ' data-current' : ''}>${match}</mark>`
      })
    })
    .join('')
}

function useJsonCollapse(lines: string[], enabled: boolean) {
  const [collapsedLines, setCollapsedLines] = useState<Set<number>>(() => new Set())
  const regions = useMemo(
    () => (enabled ? findCollapsibleRegions(lines) : new Map<number, CollapsibleRegion>()),
    [lines, enabled]
  )
  const collapsedStringLines = useMemo(() => {
    const result = new Set<number>()
    for (const lineIndex of collapsedLines) {
      if (regions.get(lineIndex)?.type === 'string') result.add(lineIndex)
    }
    return result
  }, [collapsedLines, regions])
  const visibleLineIndices = useMemo(
    () => computeVisibleLineIndices(lines.length, enabled ? collapsedLines : new Set(), regions),
    [lines.length, collapsedLines, regions, enabled]
  )
  const toggle = useCallback((lineIndex: number) => {
    setCollapsedLines((previous) => {
      const next = new Set(previous)
      if (next.has(lineIndex)) next.delete(lineIndex)
      else next.add(lineIndex)
      return next
    })
  }, [])
  return { collapsedLines, regions, collapsedStringLines, visibleLineIndices, toggle }
}

interface CodeViewerProps {
  code: string
  language: CodeViewerLanguage
  wrapText: boolean
  /** The active search, or undefined while search is closed. */
  searchQuery: string | undefined
  currentMatchIndex: number
  onMatchCountChange: (count: number) => void
  /** Receives the scroll viewport, where the search hook finds the current match. */
  contentRef: RefObject<HTMLDivElement | null>
  /** Fold multi-line JSON objects and arrays, and long strings, from a chevron column. */
  collapsible?: boolean
}

/**
 * The terminal's read-only code: numbered, syntax-highlighted lines in a virtualized viewport, with
 * wrapping, search marks that count across lines, and JSON folding, as the legacy viewer behaved.
 */
export function CodeViewer({
  code,
  language,
  wrapText,
  searchQuery,
  currentMatchIndex,
  onMatchCountChange,
  contentRef,
  collapsible = false,
}: CodeViewerProps) {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null)
  const lines = useMemo(() => code.split('\n'), [code])
  const foldable = collapsible && language === 'json'
  const { collapsedLines, regions, collapsedStringLines, visibleLineIndices, toggle } =
    useJsonCollapse(lines, foldable)
  const showFolds = foldable && regions.size > 0
  const query = searchQuery?.trim() ? searchQuery : ''

  const displayLines = useMemo(
    () =>
      lines.map((line, index) =>
        collapsedStringLines.has(index) ? truncateStringLine(line) : line
      ),
    [lines, collapsedStringLines]
  )

  const { matchOffsets, matchCount } = useMemo(() => {
    if (!query) return { matchOffsets: [] as number[], matchCount: 0 }
    const regex = new RegExp(escapeRegExp(query), 'gi')
    const visible = new Set(visibleLineIndices)
    const offsets: number[] = []
    let total = 0
    for (let i = 0; i < displayLines.length; i++) {
      offsets.push(total)
      if (visible.has(i)) total += displayLines[i].match(regex)?.length ?? 0
    }
    return { matchOffsets: offsets, matchCount: total }
  }, [displayLines, visibleLineIndices, query])

  useEffect(() => {
    onMatchCountChange(matchCount)
  }, [matchCount, onMatchCountChange])

  const visibleLines = useMemo(() => {
    return visibleLineIndices.map((index) => {
      const html = highlightLine(displayLines[index], language)
      return {
        lineNumber: index + 1,
        html: query ? markMatches(html, query, currentMatchIndex, matchOffsets[index]) : html,
      }
    })
  }, [visibleLineIndices, displayLines, language, query, currentMatchIndex, matchOffsets])

  const virtualizer = useVirtualizer({
    count: visibleLines.length,
    getScrollElement: () => viewport,
    estimateSize: () => LINE_HEIGHT,
    overscan: OVERSCAN,
    useFlushSync: false,
  })

  // Leaving wrap mode keeps the wrapped heights cached; dropping them falls back to one line each.
  useEffect(() => {
    if (!wrapText) virtualizer.measure()
  }, [wrapText, virtualizer])

  useEffect(() => {
    if (!query || matchCount === 0) return
    let accumulated = 0
    for (let i = 0; i < matchOffsets.length; i++) {
      const inLine = (matchOffsets[i + 1] ?? matchCount) - matchOffsets[i]
      if (currentMatchIndex >= accumulated && currentMatchIndex < accumulated + inLine) {
        const visibleIndex = visibleLineIndices.indexOf(i)
        if (visibleIndex !== -1) virtualizer.scrollToIndex(visibleIndex, { align: 'center' })
        break
      }
      accumulated += inLine
    }
  }, [currentMatchIndex, query, matchCount, matchOffsets, visibleLineIndices, virtualizer])

  const measureEdges = useScrollEdges<HTMLDivElement>()
  const setRefs = useCallback(
    (element: HTMLDivElement | null) => {
      setViewport(element)
      contentRef.current = element
      const stopMeasuring = measureEdges(element)
      // A returned cleanup replaces React's null call, so it also lets go of the element.
      return () => {
        stopMeasuring?.()
        setViewport(null)
        contentRef.current = null
      }
    },
    [contentRef, measureEdges]
  )

  const items = virtualizer.getVirtualItems()
  const before = items[0]?.start ?? 0
  const after = Math.max(0, virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0))
  const digits = Math.min(String(lines.length).length, 6)

  return (
    <div ref={setRefs} className={styles.viewer} data-wrap={wrapText || undefined}>
      {before > 0 && <Spacer blockSize={before} />}
      {items.map((item) => {
        const line = visibleLines[item.index]
        if (!line) return null
        const lineIndex = line.lineNumber - 1
        const canFold = showFolds && regions.has(lineIndex)
        const collapsed = collapsedLines.has(lineIndex)
        return (
          <div
            key={item.key}
            ref={virtualizer.measureElement}
            data-index={item.index}
            className={styles.row}
          >
            <span className={styles.gutter} data-digits={digits} data-type='T009'>
              {line.lineNumber}
            </span>
            {showFolds && (
              <span className={styles.fold}>
                {canFold && (
                  <IconButton
                    render={<button type='button' aria-expanded={!collapsed} />}
                    label={collapsed ? 'Expand' : 'Collapse'}
                    icon={collapsed ? 'I090' : 'I051'}
                    size='inline'
                    onClick={() => toggle(lineIndex)}
                  />
                )}
              </span>
            )}
            <pre
              className={styles.code}
              data-type='T014'
              dangerouslySetInnerHTML={{ __html: line.html || '&nbsp;' }}
            />
          </div>
        )
      })}
      {after > 0 && <Spacer blockSize={after} />}
    </div>
  )
}

/** Stands in for the lines outside the window, keeping the viewport's full height. */
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
