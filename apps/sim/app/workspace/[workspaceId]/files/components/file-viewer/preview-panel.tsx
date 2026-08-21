'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import '@sim/emcn/components/code/code.css'
import { CSV_PREVIEW_MAX_ROWS } from '@/lib/api/contracts/workspace-file-table'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import {
  SIM_ARTIFACT_SHELL,
  SIM_ARTIFACT_STYLESHEET,
  simTokenOverrides,
  usesSimArtifactStyles,
} from '@/lib/workspace-files/artifact-stylesheet'
import { compileSimPage, isSimPageSource } from '@/lib/workspace-files/page-compile'
import { useHorizontalWheelScroll } from '@/app/workspace/[workspaceId]/files/components/file-viewer/use-horizontal-wheel-scroll'
import { useWorkspaceFileBinary } from '@/hooks/queries/workspace-files'
import { ChartPreview } from './chart-preview'
import { type CsvImportFileDescriptor, useCsvTruncationImport } from './csv-import'
import { DataTable } from './data-table'
import { MermaidDiagram } from './mermaid-diagram'
import { ZoomablePreview } from './zoomable-preview'

type PreviewType = 'markdown' | 'html' | 'csv' | 'svg' | 'mermaid' | 'chart' | null

const PREVIEWABLE_MIME_TYPES: Record<string, PreviewType> = {
  // Sim pages store an EXTENSIONLESS name — without this mapping the record
  // type resolves to no preview at all and the viewer renders a blank pane
  // (including the live compile-as-it-streams view).
  'text/x-sim-page': 'html',
  'text/markdown': 'markdown',
  'text/html': 'html',
  'text/csv': 'csv',
  'image/svg+xml': 'svg',
  'text/x-mermaid': 'mermaid',
  'text/x-sim-chart': 'chart',
}

const PREVIEWABLE_EXTENSIONS: Record<string, PreviewType> = {
  md: 'markdown',
  html: 'html',
  htm: 'html',
  csv: 'csv',
  svg: 'svg',
  mmd: 'mermaid',
  chart: 'chart',
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
  fileId: string
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
  fileId,
  fileKey,
  isStreaming,
  readOnly,
}: PreviewPanelProps) {
  const previewType = resolvePreviewType(mimeType, filename)

  if (previewType === 'html')
    return (
      <HtmlPreview
        content={content}
        isStreaming={isStreaming}
        workspaceId={workspaceId}
        fileId={fileId}
        fileKey={fileKey}
      />
    )
  if (previewType === 'csv')
    return (
      <CsvPreview
        content={content}
        workspaceId={workspaceId}
        file={{ id: fileId, key: fileKey, name: filename }}
        readOnly={readOnly}
      />
    )
  if (previewType === 'svg') return <SvgPreview content={content} />
  if (previewType === 'mermaid')
    return <MermaidFilePreview content={content} isStreaming={isStreaming} />
  if (previewType === 'chart')
    return <ChartPreview content={content} workspaceId={workspaceId} isStreaming={isStreaming} />

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
      // The sandbox can neither navigate nor open windows, so hand the click
      // to the host: workspace routes go through the app router, external
      // http(s) links open a new tab.
      if (href.startsWith('/workspace/') || /^https?:\\/\\//i.test(href)) {
        parent.postMessage({ __simPageNav: href }, '*')
      }
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

function stampTheme(html: string, theme: 'dark' | 'light'): string {
  if (/<html[\s>]/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match, attrs: string | undefined) =>
      /\sdata-theme=/i.test(attrs ?? '') ? match : `<html data-theme="${theme}"${attrs ?? ''}>`
    )
  }
  return html
}

export function buildHtmlPreviewDocument(
  content: string,
  theme: 'dark' | 'light' = 'light',
  workspaceId?: string
): string {
  // The pdf model: a page file STORES its source (frontmatter + markdown +
  // sim: fences) and every rendering surface compiles on demand. Partial
  // source mid-stream compiles too, so the page builds up live as the agent
  // appends. Raw HTML (bespoke and legacy stored-compiled pages) skips this.
  if (isSimPageSource(content)) {
    content = compileSimPage(content, { workspaceId })
  } else if (content.trimStart().startsWith('---')) {
    // Page source that does not compile yet — frontmatter still streaming in,
    // or a malformed header. Never show a reader raw source: hold the empty
    // themed shell (the marker pulls the stylesheet in below) until a
    // compilable snapshot arrives.
    content =
      '<!DOCTYPE html><html><head><meta name="sim-artifact"><title>Page</title></head><body></body></html>'
  }
  const headInjection = [
    '<meta charset="utf-8">',
    `<base href="${HTML_PREVIEW_BASE_URL}">`,
    `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`,
    // Ahead of the page's own <style>, so anything it declares still wins. The
    // token overrides follow the sheet so the app's live values beat its
    // fallbacks, and the shell follows both.
    usesSimArtifactStyles(content)
      ? `<style>${SIM_ARTIFACT_STYLESHEET}</style><style>${simTokenOverrides(theme)}</style>${SIM_ARTIFACT_SHELL}`
      : '',
    HTML_PREVIEW_BOOTSTRAP,
  ].join('')

  if (/<head[\s>]/i.test(content)) {
    return stampTheme(
      content.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${headInjection}`),
      theme
    )
  }

  if (/<html[\s>]/i.test(content)) {
    return stampTheme(
      content.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${headInjection}</head>`),
      theme
    )
  }

  return `<!DOCTYPE html><html data-theme="${theme}"><head>${headInjection}</head><body>${content}</body></html>`
}

/**
 * Batches iframe content updates while an agent streams. Every content change
 * replaces the srcDoc (a full document reload), so applying each chunk as it
 * arrives would reload the page several times a second; ~2s batches keep the
 * growing page readable. Off-stream, the live value passes straight through.
 */
function useStreamBatchedValue(value: string, streaming: boolean, intervalMs: number): string {
  const [batched, setBatched] = useState(value)
  const lastAppliedAtRef = useRef(0)
  useEffect(() => {
    if (!streaming) {
      lastAppliedAtRef.current = 0
      setBatched(value)
      return
    }
    const elapsed = Date.now() - lastAppliedAtRef.current
    if (elapsed >= intervalMs) {
      lastAppliedAtRef.current = Date.now()
      setBatched(value)
      return
    }
    const timer = setTimeout(() => {
      lastAppliedAtRef.current = Date.now()
      setBatched(value)
    }, intervalMs - elapsed)
    return () => clearTimeout(timer)
  }, [value, streaming, intervalMs])
  return streaming ? batched : value
}

/**
 * The sandboxed frame carries no cookies, so a workspace image
 * (`/api/files/view/<id>`, what `![alt](sim:file/<id>)` compiles to) would
 * 401 inside it. The host fetches the bytes with its own session and hands
 * the frame blob: URLs, which the preview CSP already allows.
 */
function useInlinedWorkspaceImages(content: string): string {
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const cacheRef = useRef<Map<string, string> | null>(null)
  cacheRef.current ??= new Map()
  useEffect(() => {
    const cache = cacheRef.current
    if (!cache) return
    const urls = [...content.matchAll(/src="(\/api\/files\/view\/[^"]+)"/g)].map((m) => m[1])
    const missing = [...new Set(urls)].filter((url) => !cache.has(url))
    if (missing.length === 0) return
    let cancelled = false
    for (const url of missing) {
      // boundary-raw-fetch: binary image bytes for the cookie-less sandboxed preview
      fetch(url)
        .then((response) => (response.ok ? response.blob() : null))
        .then(
          (blob) =>
            new Promise<string | null>((resolve) => {
              if (!blob) return resolve(null)
              // data: URIs, NOT blob: URLs — blob URLs are origin-bound and
              // the sandboxed frame's origin is opaque, so Chromium refuses
              // to render a parent-origin blob inside it. data: is
              // origin-independent and already allowed by the preview CSP.
              const reader = new FileReader()
              reader.onload = () =>
                resolve(typeof reader.result === 'string' ? reader.result : null)
              reader.onerror = () => resolve(null)
              reader.readAsDataURL(blob)
            })
        )
        .then((dataUri) => {
          if (!dataUri || cancelled) return
          cache.set(url, dataUri)
          setResolved((prev) => ({ ...prev, [url]: dataUri }))
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [content])
  return useMemo(
    () =>
      content.replace(/src="(\/api\/files\/view\/[^"]+)"/g, (match, url: string) => {
        const blobUrl = cacheRef.current?.get(url) ?? resolved[url]
        return blobUrl ? `src="${blobUrl}"` : match
      }),
    [content, resolved]
  )
}

const HtmlPreview = memo(function HtmlPreview({
  content,
  isStreaming,
  workspaceId,
  fileId,
  fileKey,
}: {
  content: string
  isStreaming?: boolean
  workspaceId?: string
  fileId?: string
  fileKey?: string
}) {
  const { resolvedTheme } = useTheme()
  const router = useRouter()
  const batchedContent = useStreamBatchedValue(content, isStreaming === true, 2000)
  // A SAVED sim page prefers the server-compiled document — the pptx/docx
  // model: the serve route resolves chart references (reading a table's
  // CURRENT rows under the viewer's authorization) and inlines the chart
  // runtime, and reopening/refocusing refetches, so the page recompiles on
  // reload. While it loads — and always while streaming/editing — the client
  // compile below stands in, with chart figures as placeholders.
  const isSavedPage =
    Boolean(fileId && fileKey && workspaceId) && isStreaming !== true && isSimPageSource(content)
  const served = useWorkspaceFileBinary(workspaceId ?? '', fileId ?? '', fileKey ?? '', {
    enabled: isSavedPage,
  })
  const servedHtml = useMemo(
    () => (isSavedPage && served.data ? new TextDecoder().decode(served.data) : null),
    [isSavedPage, served.data]
  )
  const builtContent = buildHtmlPreviewDocument(
    servedHtml ?? batchedContent,
    resolvedTheme === 'dark' ? 'dark' : 'light',
    workspaceId
  )
  // AFTER the build: workspace image srcs (/api/files/view/…) only exist in
  // the COMPILED document — the raw source says sim:file/… — so substituting
  // the host-fetched blob: URLs must run on the built output, or the
  // sandboxed (cookie-less) frame 401s every image.
  const wrappedContent = useInlinedWorkspaceImages(builtContent)

  // Receives sim-resource link clicks bridged out of the sandboxed page and
  // routes them in the app. Only workspace-internal paths are honored.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const href = (event.data as { __simPageNav?: unknown } | null)?.__simPageNav
      if (typeof href !== 'string') return
      if (href.startsWith('/workspace/')) {
        router.push(href)
      } else if (/^https?:\/\//i.test(href)) {
        // The server-compiled document absolutizes workspace links (so a
        // DOWNLOADED copy reaches Sim) — recognize our own origin and route
        // in-app rather than spawning a new tab of the whole app.
        try {
          const url = new URL(href)
          if (url.origin === window.location.origin && url.pathname.startsWith('/workspace/')) {
            router.push(`${url.pathname}${url.search}${url.hash}`)
            return
          }
        } catch {}
        window.open(href, '_blank', 'noopener,noreferrer')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [router])
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
    <div ref={containerRef} className='flex min-h-0 flex-1 overflow-hidden'>
      {isRenderable && (
        <iframe
          key={resumeNonce}
          srcDoc={wrappedContent}
          /* No clipboard-write delegation: this frame also renders untrusted
             raw HTML uploads, and a permissions-policy grant would let their
             inline scripts replace the viewer's clipboard without a gesture.
             The shell's copy buttons use the selection-command fallback,
             which works in the sandbox but only on a real user click. */
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
    <ZoomablePreview className='min-h-0 flex-1' contentClassName='h-full w-full'>
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
    <div className='min-h-0 flex-1 overflow-auto p-6'>
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
  const scrollRef = useHorizontalWheelScroll()
  const { headers, rows, truncated } = useMemo(() => parseCsv(content), [content])
  useCsvTruncationImport(workspaceId, file, truncated, readOnly)

  if (headers.length === 0) {
    return (
      <div className='flex min-h-0 flex-1 items-center justify-center p-6'>
        <p className='text-[13px] text-[var(--text-muted)]'>No data to display</p>
      </div>
    )
  }

  return (
    <div ref={scrollRef} className='min-h-0 flex-1 overflow-auto p-6'>
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
