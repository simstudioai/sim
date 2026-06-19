'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import '@/components/emcn/components/code/code.css'
import { CSV_PREVIEW_MAX_ROWS } from '@/lib/api/contracts/workspace-file-table'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { type CsvImportFileDescriptor, useCsvTruncationImport } from './csv-import'
import { DataTable } from './data-table'
import { PreviewLoadingFrame } from './preview-shared'
import { ZoomablePreview } from './zoomable-preview'

type PreviewType = 'markdown' | 'html' | 'csv' | 'svg' | 'mermaid' | null

const PREVIEWABLE_MIME_TYPES: Record<string, PreviewType> = {
  'text/markdown': 'markdown',
  'text/html': 'html',
  'text/csv': 'csv',
  'image/svg+xml': 'svg',
  'text/x-mermaid': 'mermaid',
}

const PREVIEWABLE_EXTENSIONS: Record<string, PreviewType> = {
  md: 'markdown',
  html: 'html',
  htm: 'html',
  csv: 'csv',
  svg: 'svg',
  mmd: 'mermaid',
}

/** All extensions that have a rich preview renderer. */
export const RICH_PREVIEWABLE_EXTENSIONS = new Set(Object.keys(PREVIEWABLE_EXTENSIONS))

export function resolvePreviewType(mimeType: string | null, filename: string): PreviewType {
  if (mimeType && PREVIEWABLE_MIME_TYPES[mimeType]) return PREVIEWABLE_MIME_TYPES[mimeType]
  const ext = getFileExtension(filename)
  return PREVIEWABLE_EXTENSIONS[ext] ?? null
}

interface PreviewPanelProps {
  content: string
  mimeType: string | null
  filename: string
  workspaceId: string
  fileKey: string
  isStreaming?: boolean
  /**
   * Read-only surface (e.g. the public share page) — disables interactive
   * affordances such as the CSV "Import as a table" action, which needs an
   * authenticated workspace import.
   */
  readOnly?: boolean
}

export const PreviewPanel = memo(function PreviewPanel({
  content,
  mimeType,
  filename,
  workspaceId,
  fileKey,
  isStreaming,
  readOnly,
}: PreviewPanelProps) {
  const previewType = resolvePreviewType(mimeType, filename)

  if (previewType === 'html') return <HtmlPreview content={content} />
  if (previewType === 'csv')
    return (
      <CsvPreview
        content={content}
        workspaceId={workspaceId}
        file={{ key: fileKey, name: filename }}
        readOnly={readOnly}
      />
    )
  if (previewType === 'svg') return <SvgPreview content={content} />
  if (previewType === 'mermaid')
    return <MermaidFilePreview content={content} isStreaming={isStreaming} />

  return null
})

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

function MermaidCodeBlockFallback() {
  return (
    <div className='my-4 overflow-hidden rounded-lg border border-[var(--border)]'>
      <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-3)] px-3 py-1.5'>
        <span className='text-[11px] text-[var(--text-tertiary)]'>mermaid</span>
        <span className='text-[11px] text-[var(--text-muted)]'>Rendering…</span>
      </div>
      <div className='code-editor-theme min-h-[96px] bg-[var(--surface-5)]'>
        <div className='p-4' />
      </div>
    </div>
  )
}

const MermaidDiagram = memo(function MermaidDiagram({
  definition,
  isStreaming = false,
  zoomable = false,
  zoomClassName,
}: {
  definition: string
  isStreaming?: boolean
  zoomable?: boolean
  zoomClassName?: string
}) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isRendering, setIsRendering] = useState(false)
  const [renderedDefinition, setRenderedDefinition] = useState<string | null>(null)
  const trimmedDefinition = definition.trim()

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!trimmedDefinition) {
      setSvg(null)
      setError(null)
      setIsRendering(false)
      setRenderedDefinition(null)
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
          theme: 'default',
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
          setSvg(rendered)
          setRenderedDefinition(trimmedDefinition)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          if (isStreaming) {
            setError(null)
          } else {
            setError(toError(err).message || 'Failed to render diagram')
            setSvg(null)
            setRenderedDefinition(null)
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
  }, [trimmedDefinition, isStreaming])

  if (error) {
    return (
      <MermaidSourcePreview definition={definition} isRendering={false} status='Invalid diagram' />
    )
  }

  if (svg && renderedDefinition === trimmedDefinition) {
    const diagram = <div dangerouslySetInnerHTML={{ __html: svg }} />

    if (zoomable) {
      return (
        <ZoomablePreview
          className={zoomClassName ?? 'my-4 h-[420px] rounded-lg'}
          initialScale='fit'
          resetKey={renderedDefinition}
        >
          {diagram}
        </ZoomablePreview>
      )
    }

    return (
      <div className='my-4 overflow-auto rounded-lg' dangerouslySetInnerHTML={{ __html: svg }} />
    )
  }

  if (isStreaming) {
    return <MermaidSourcePreview definition={definition} isRendering={isRendering} />
  }

  if (!trimmedDefinition || !svg || renderedDefinition !== trimmedDefinition) {
    if (zoomable) {
      return <PreviewLoadingFrame className='h-full' />
    }
    return <MermaidCodeBlockFallback />
  }
  return null
})

const HTML_PREVIEW_BASE_URL = 'about:srcdoc'

const HTML_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
].join('; ')

const HTML_PREVIEW_BOOTSTRAP = `<script>
(() => {
  const allowHref = (href) => href.startsWith('#') || /^\\s*javascript:/i.test(href)

  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return
      const anchor = event.target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      const href = anchor.getAttribute('href') || ''
      if (allowHref(href)) return
      event.preventDefault()
    },
    true
  )

  document.addEventListener(
    'submit',
    (event) => {
      event.preventDefault()
    },
    true
  )

})()
</script>`

function buildHtmlPreviewDocument(content: string): string {
  const headInjection = [
    '<meta charset="utf-8">',
    `<base href="${HTML_PREVIEW_BASE_URL}">`,
    `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`,
    HTML_PREVIEW_BOOTSTRAP,
  ].join('')

  if (/<head[\s>]/i.test(content)) {
    return content.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${headInjection}`)
  }

  if (/<html[\s>]/i.test(content)) {
    return content.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${headInjection}</head>`)
  }

  return `<!DOCTYPE html><html><head>${headInjection}</head><body>${content}</body></html>`
}

const HtmlPreview = memo(function HtmlPreview({ content }: { content: string }) {
  const wrappedContent = buildHtmlPreviewDocument(content)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isRenderable, setIsRenderable] = useState(false)
  const [resumeNonce, setResumeNonce] = useState(0)
  const pageWasHiddenRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const updateRenderability = (width: number, height: number) => {
      setIsRenderable(width > 0 && height > 0)
    }

    const initialRect = container.getBoundingClientRect()
    updateRenderability(initialRect.width, initialRect.height)

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      updateRenderability(entry.contentRect.width, entry.contentRect.height)
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        pageWasHiddenRef.current = true
        return
      }

      if (document.visibilityState === 'visible' && pageWasHiddenRef.current) {
        pageWasHiddenRef.current = false
        setResumeNonce((nonce) => nonce + 1)
      }
    }

    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        setResumeNonce((nonce) => nonce + 1)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [])

  return (
    <div ref={containerRef} className='h-full overflow-hidden'>
      {isRenderable && (
        <iframe
          key={resumeNonce}
          srcDoc={wrappedContent}
          sandbox='allow-scripts'
          referrerPolicy='no-referrer'
          title='HTML Preview'
          className='h-full w-full border-0 bg-[var(--surface-2)]'
        />
      )}
    </div>
  )
})

function SvgPreview({ content }: { content: string }) {
  const [blobUrl, setBlobUrl] = useState('')

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }))
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [content])

  return (
    <ZoomablePreview className='h-full' contentClassName='h-full w-full'>
      {blobUrl && (
        <img
          src={blobUrl}
          alt='SVG preview'
          className='max-h-full max-w-full select-none object-contain'
          draggable={false}
        />
      )}
    </ZoomablePreview>
  )
}

function MermaidFilePreview({ content, isStreaming }: { content: string; isStreaming?: boolean }) {
  return (
    <div className='h-full overflow-auto p-6'>
      <MermaidDiagram
        definition={content}
        isStreaming={isStreaming}
        zoomable
        zoomClassName='h-full rounded-lg'
      />
    </div>
  )
}

const CsvPreview = memo(function CsvPreview({
  content,
  workspaceId,
  file,
  readOnly,
}: {
  content: string
  workspaceId: string
  file: CsvImportFileDescriptor
  readOnly?: boolean
}) {
  const { headers, rows, truncated } = useMemo(() => parseCsv(content), [content])
  useCsvTruncationImport(workspaceId, file, truncated, readOnly)

  if (headers.length === 0) {
    return (
      <div className='flex h-full items-center justify-center p-6'>
        <p className='text-[13px] text-[var(--text-muted)]'>No data to display</p>
      </div>
    )
  }

  return (
    <div className='h-full overflow-auto p-6'>
      <DataTable headers={headers} rows={rows} />
    </div>
  )
})

/**
 * Parses CSV text for the inline preview, capping at {@link CSV_PREVIEW_MAX_ROWS} rows so a
 * small-but-many-rows file doesn't render thousands of `<tr>`s. Slices before parsing so only
 * the capped rows are processed; `truncated` drives the "Import as a table" footer.
 */
function parseCsv(text: string): { headers: string[]; rows: string[][]; truncated: boolean } {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [], truncated: false }

  const delimiter = detectDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delimiter)
  const dataLines = lines.slice(1)
  const truncated = dataLines.length > CSV_PREVIEW_MAX_ROWS
  const rows = dataLines.slice(0, CSV_PREVIEW_MAX_ROWS).map((line) => parseCsvLine(line, delimiter))

  return { headers, rows, truncated }
}

function detectDelimiter(line: string): string {
  const commaCount = (line.match(/,/g) || []).length
  const tabCount = (line.match(/\t/g) || []).length
  const semiCount = (line.match(/;/g) || []).length
  if (tabCount > commaCount && tabCount > semiCount) return '\t'
  if (semiCount > commaCount) return ';'
  return ','
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === delimiter) {
        fields.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
  }

  fields.push(current.trim())
  return fields
}
