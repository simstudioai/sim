'use client'

import { useEffect, useRef, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/mermaid-diagram.module.css'
import { tokenColors } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/resolve-colors'
import { useResolvedTheme } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/use-resolved-theme'
import { ZoomablePreview } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/zoomable-preview'
import { mermaidWorkflowCss } from '@/platform/lib/data/files/preview'

/** Waits out a burst of streamed edits before parsing the definition again. */
const STREAMING_RENDER_DELAY_MS = 150
const SVG_CACHE_LIMIT = 64
const svgCache = new Map<string, string>()

function cacheSvg(key: string, value: string) {
  if (svgCache.size >= SVG_CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value
    if (oldest !== undefined) svgCache.delete(oldest)
  }
  svgCache.set(key, value)
}

const THEME_TOKENS = [
  '--ui-reading',
  '--ui-ink',
  '--ui-secondary',
  '--ui-muted',
  '--ui-border',
  '--ui-hover',
  '--ui-selected',
  '--control-muted-fill',
] as const

/** Mermaid's base theme, colored from the surface's tokens. */
function themeVariables(host: HTMLElement, dark: boolean) {
  const c = tokenColors(host, THEME_TOKENS)
  const background = c['--ui-reading']
  const node = c['--control-muted-fill']
  const muted = c['--ui-hover']
  const border = c['--ui-border']
  const text = c['--ui-ink']
  const line = c['--ui-secondary']
  return {
    darkMode: dark,
    fontFamily: getComputedStyle(host).fontFamily,
    fontSize: '14px',
    background,
    primaryColor: node,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: muted,
    secondaryTextColor: text,
    secondaryBorderColor: border,
    tertiaryColor: c['--ui-selected'],
    tertiaryTextColor: text,
    tertiaryBorderColor: border,
    mainBkg: node,
    nodeBorder: border,
    textColor: text,
    lineColor: line,
    clusterBkg: muted,
    clusterBorder: border,
    edgeLabelBackground: background,
    noteBkgColor: muted,
    noteTextColor: text,
    noteBorderColor: border,
    actorBkg: node,
    actorBorder: border,
    actorTextColor: text,
    actorLineColor: line,
    signalColor: line,
    signalTextColor: text,
    labelBoxBkgColor: muted,
    labelBoxBorderColor: border,
    labelTextColor: text,
    loopTextColor: text,
    sequenceNumberColor: background,
    pie1: text,
    pie2: line,
    pie3: c['--ui-muted'],
    pie4: border,
    pieStrokeColor: background,
    pieTitleTextColor: text,
    pieSectionTextColor: background,
    pieLegendTextColor: text,
  }
}

interface MermaidDiagramProps {
  definition: string
  /** A definition still being written: a partial one keeps the last good diagram, without error. */
  isStreaming?: boolean
  /** Draws the diagram in a zoomable, pannable frame. */
  zoomable?: boolean
  /** The zoomable frame fills its parent instead of keeping an inline diagram's height. */
  stretch?: boolean
}

/** A Mermaid diagram, rendered strict and themed to the surface; an invalid one shows its source. */
export function MermaidDiagram({
  definition,
  isStreaming = false,
  zoomable,
  stretch,
}: MermaidDiagramProps) {
  const theme = useResolvedTheme()
  const hostRef = useRef<HTMLDivElement>(null)
  const trimmed = definition.trim()
  const cacheKey = `${theme}\u0000${trimmed}`
  const [svg, setSvg] = useState<{ key: string; markup: string } | null>(() => {
    const cached = svgCache.get(cacheKey)
    return cached ? { key: cacheKey, markup: cached } : null
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!trimmed) {
      setSvg(null)
      setError(null)
      return
    }
    const cached = svgCache.get(cacheKey)
    if (cached) {
      setSvg({ key: cacheKey, markup: cached })
      setError(null)
      return
    }
    let cancelled = false
    const render = async () => {
      try {
        const host = hostRef.current
        if (!host) return
        const { default: mermaid } = await import('mermaid')
        if (cancelled) return
        const variables = themeVariables(host, theme === 'dark')
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'base',
          themeCSS: mermaidWorkflowCss(String(variables.fontFamily)),
          flowchart: {
            curve: 'basis',
            padding: 12,
            nodeSpacing: 36,
            rankSpacing: 56,
            wrappingWidth: 180,
          },
          themeVariables: variables,
        })
        mermaid.setParseErrorHandler?.(() => undefined)
        if (isStreaming) {
          const parsed = await mermaid.parse(trimmed, { suppressErrors: true })
          if (!parsed) return
        } else {
          await mermaid.parse(trimmed)
        }
        const { svg: rendered } = await mermaid.render(`mermaid-${generateShortId(8)}`, trimmed)
        if (cancelled) return
        cacheSvg(cacheKey, rendered)
        setSvg({ key: cacheKey, markup: rendered })
        setError(null)
      } catch (failure) {
        if (cancelled || isStreaming) return
        setError(toError(failure).message || 'Failed to render diagram')
        setSvg(null)
      }
    }
    setError(null)
    const timer = setTimeout(() => void render(), isStreaming ? STREAMING_RENDER_DELAY_MS : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [trimmed, isStreaming, theme, cacheKey])

  const current = svg?.key === cacheKey ? svg.markup : null
  if (error || (isStreaming && !current))
    return (
      <div ref={hostRef} className={styles.source}>
        <div className={styles.sourceHeader} data-type='T052'>
          <span>mermaid</span>
          {error && <span>Invalid diagram</span>}
        </div>
        <pre className={styles.sourceCode} data-type='T014'>
          <code>{definition}</code>
        </pre>
      </div>
    )
  if (current && zoomable)
    return (
      <div ref={hostRef} className={stretch ? styles.stretch : styles.zoomFrame}>
        <ZoomablePreview key={cacheKey} initialScale='fit'>
          <div className={styles.svg} dangerouslySetInnerHTML={{ __html: current }} />
        </ZoomablePreview>
      </div>
    )
  return (
    <div
      ref={hostRef}
      className={styles.inline}
      dangerouslySetInnerHTML={current ? { __html: current } : undefined}
    />
  )
}
