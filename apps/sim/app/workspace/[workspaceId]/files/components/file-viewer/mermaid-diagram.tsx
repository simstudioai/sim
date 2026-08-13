'use client'

import { memo, useEffect, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { useTheme } from 'next-themes'
import { PreviewLoadingFrame } from './preview-shared'
import { ZoomablePreview } from './zoomable-preview'

/** First-line keywords that start a Mermaid diagram definition. */
const MERMAID_OPENERS =
  /^(?:flowchart|graph|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|journey|gantt|pie|quadrantChart|requirementDiagram|gitGraph|mindmap|timeline|sankey-beta|xychart-beta|block-beta|packet-beta|kanban|architecture-beta|zenuml|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/

/**
 * Whether a code block's text reads as a Mermaid definition (its first non-empty line opens with a
 * known diagram keyword). Lets an untagged ```` ``` ```` block of Mermaid render as a diagram — the
 * same lightweight heuristic Linear and GitHub use — without loading the (heavy) `mermaid` library
 * for ordinary code.
 */
export function looksLikeMermaid(text: string): boolean {
  const firstLine = text.split('\n').find((line) => line.trim().length > 0)
  return firstLine !== undefined && MERMAID_OPENERS.test(firstLine.trim())
}

/**
 * Process-lifetime cache of rendered SVGs, keyed by theme + definition. Toggling a diagram's source
 * view and back unmounts/remounts this component; without the cache the remount would re-render from
 * scratch and flash a loading frame. A small cap keeps it from growing unbounded.
 */
const SVG_CACHE_LIMIT = 64
const svgCache = new Map<string, string>()
function cacheSvg(key: string, value: string): void {
  if (svgCache.size >= SVG_CACHE_LIMIT) {
    const oldest = svgCache.keys().next().value
    if (oldest !== undefined) svgCache.delete(oldest)
  }
  svgCache.set(key, value)
}

function MermaidSourcePreview({
  definition,
  isRendering,
  status,
}: {
  definition: string
  isRendering: boolean
  status?: string
}) {
  return (
    <div className='my-4 overflow-hidden rounded-lg border border-[var(--border)]'>
      <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-3)] px-3 py-1.5'>
        <span className='text-[11px] text-[var(--text-tertiary)]'>mermaid</span>
        {(isRendering || status) && (
          <span className='text-[11px] text-[var(--text-muted)]'>
            {isRendering ? 'Rendering…' : status}
          </span>
        )}
      </div>
      <div className='code-editor-theme bg-[var(--surface-5)]'>
        <pre className='m-0 overflow-x-auto whitespace-pre p-4 font-mono text-[13px] text-[var(--text-primary)] leading-[1.6]'>
          <code>{definition}</code>
        </pre>
      </div>
    </div>
  )
}

/**
 * Renders a Mermaid definition to an SVG diagram, lazy-loading the (heavy) `mermaid` library on
 * first use. Falls back to the source (with an "Invalid diagram" status) on a parse/render error.
 * Shared by the file preview (`.mmd` files, zoomable) and the rich markdown editor's ` ```mermaid `
 * code block (inline).
 */
export const MermaidDiagram = memo(function MermaidDiagram({
  definition,
  isStreaming = false,
  zoomable = false,
  zoomClassName,
  className,
}: {
  definition: string
  isStreaming?: boolean
  zoomable?: boolean
  zoomClassName?: string
  /** Wrapper class for the rendered (non-zoomable) SVG. Defaults to the file-preview look. */
  className?: string
}) {
  const { resolvedTheme } = useTheme()
  const mermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'default'
  const trimmedDefinition = definition.trim()
  const cacheKey = `${mermaidTheme}\u0000${trimmedDefinition}`
  const [svg, setSvg] = useState<string | null>(() => svgCache.get(cacheKey) ?? null)
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [renderedKey, setRenderedKey] = useState<string | null>(() =>
    svgCache.has(cacheKey) ? cacheKey : null
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!trimmedDefinition) {
      setSvg(null)
      setError(null)
      setIsRendering(false)
      setRenderedKey(null)
      return
    }

    const cached = svgCache.get(cacheKey)
    if (cached) {
      setSvg(cached)
      setRenderedKey(cacheKey)
      setError(null)
      setIsRendering(false)
      return
    }

    let cancelled = false
    const renderDelay = isStreaming ? 150 : 0

    async function render() {
      try {
        setIsRendering(true)
        const { default: mermaid } = await import('mermaid')
        if (cancelled) return

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: mermaidTheme,
        })
        mermaid.setParseErrorHandler?.(() => undefined)

        if (isStreaming) {
          const parsed = await mermaid.parse(trimmedDefinition, { suppressErrors: true })
          if (!parsed) {
            if (!cancelled) {
              setError(null)
            }
            return
          }
        } else {
          await mermaid.parse(trimmedDefinition)
        }

        const { svg: rendered } = await mermaid.render(
          `mermaid-${generateShortId(8)}`,
          trimmedDefinition
        )
        if (!cancelled) {
          cacheSvg(cacheKey, rendered)
          setSvg(rendered)
          setRenderedKey(cacheKey)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          if (isStreaming) {
            setError(null)
          } else {
            setError(toError(err).message || 'Failed to render diagram')
            setSvg(null)
            setRenderedKey(null)
          }
        }
      } finally {
        if (!cancelled) {
          setIsRendering(false)
        }
      }
    }

    setError(null)
    const timer = window.setTimeout(() => {
      render()
    }, renderDelay)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [trimmedDefinition, isStreaming, mermaidTheme, cacheKey])

  if (error) {
    return (
      <MermaidSourcePreview definition={definition} isRendering={false} status='Invalid diagram' />
    )
  }

  if (svg && renderedKey === cacheKey) {
    if (zoomable) {
      return (
        <ZoomablePreview
          className={zoomClassName ?? 'my-4 h-[420px] rounded-lg'}
          initialScale='fit'
          resetKey={cacheKey}
        >
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        </ZoomablePreview>
      )
    }

    return (
      <div
        className={className ?? 'my-4 overflow-auto rounded-lg'}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }

  if (isStreaming) {
    return <MermaidSourcePreview definition={definition} isRendering={isRendering} />
  }

  // Not yet rendered: hold the diagram's own frame (not a distinct card) so the fill-in is seamless.
  if (zoomable) {
    return <PreviewLoadingFrame className='h-full' />
  }
  return <div className={className ?? 'my-4 min-h-[96px] overflow-auto rounded-lg'} />
})
