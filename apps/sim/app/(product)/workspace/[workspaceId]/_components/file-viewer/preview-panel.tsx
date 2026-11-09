'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { DataTable } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/data-table'
import { MermaidDiagram } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/mermaid-diagram'
import { useResolvedTheme } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/use-resolved-theme'
import { ZoomablePreview } from '@/app/(product)/workspace/[workspaceId]/_components/file-preview/zoomable-preview'
import { ChartPreview } from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/chart-preview'
import styles from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/preview-panel.module.css'
import { resolvePreviewType } from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/preview-type'
import { useHorizontalWheelScroll } from '@/app/(product)/workspace/[workspaceId]/_components/file-viewer/use-horizontal-wheel-scroll'
import { CSV_PREVIEW_MAX_ROWS, useWorkspaceFileBinary } from '@/platform/lib/data/files'
import {
  compileSimPage,
  isSimPageSource,
  SIM_ARTIFACT_SHELL,
  SIM_ARTIFACT_STYLESHEET,
  simTokenOverrides,
  useCsvTruncationImport,
  usesSimArtifactStyles,
} from '@/platform/lib/data/files/preview'

interface PreviewPanelProps {
  content: string
  mimeType: string | null
  filename: string
  workspaceId: string
  fileId: string
  fileKey: string
  isStreaming?: boolean
}

/** The rendered side of a text file: a page, a table, an image, a diagram or a chart. */
export function PreviewPanel({
  content,
  mimeType,
  filename,
  workspaceId,
  fileId,
  fileKey,
  isStreaming,
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
      />
    )
  if (previewType === 'svg') return <SvgPreview content={content} />
  if (previewType === 'mermaid')
    return (
      <div className={styles.mermaid}>
        <MermaidDiagram definition={content} isStreaming={isStreaming} zoomable stretch />
      </div>
    )
  if (previewType === 'chart')
    return <ChartPreview content={content} workspaceId={workspaceId} isStreaming={isStreaming} />
  return null
}

const HTML_PREVIEW_BASE_URL = 'about:srcdoc'
/** Stream batches: each srcdoc change reloads the frame, so a growing page refreshes this often. */
const STREAM_BATCH_MS = 2000

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

/**
 * Runs inside the sandboxed frame: fragment links scroll the page, and every other link click is
 * handed to the host, which routes workspace links in the app and opens web links in a new tab.
 */
const HTML_PREVIEW_BOOTSTRAP = `<script>
(() => {
  const allowHref = (href) => /^\\s*javascript:/i.test(href)
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const anchor = event.target.closest('a[href]')
    if (!(anchor instanceof HTMLAnchorElement)) return
    const href = anchor.getAttribute('href') || ''
    if (href.startsWith('#')) {
      event.preventDefault()
      location.hash = href
      let id = href.slice(1)
      try { id = decodeURIComponent(id) } catch {}
      const target = document.getElementById(id)
      if (target) {
        target.scrollIntoView()
        target.focus({ preventScroll: true })
      } else if (!id) {
        window.scrollTo(0, 0)
      }
      return
    }
    if (allowHref(href)) return
    event.preventDefault()
    if (href.startsWith('/workspace/') || /^https?:\\/\\//i.test(href)) {
      parent.postMessage({ __simPageNav: href }, '*')
    }
  }, true)
  document.addEventListener('submit', (event) => { event.preventDefault() }, true)
})()
</script>`

function stampTheme(html: string, theme: 'dark' | 'light'): string {
  if (!/<html[\s>]/i.test(html)) return html
  return html.replace(/<html(\s[^>]*)?>/i, (match, attrs: string | undefined) =>
    /\sdata-theme=/i.test(attrs ?? '') ? match : `<html data-theme="${theme}"${attrs ?? ''}>`
  )
}

/**
 * A page file stores its source and every surface compiles it on demand, partial source while it
 * streams included. Source whose header does not compile yet shows an empty themed shell, never raw
 * source. Raw HTML passes through.
 */
function buildHtmlPreviewDocument(content: string, theme: 'dark' | 'light', workspaceId: string) {
  let html = content
  if (isSimPageSource(html)) html = compileSimPage(html, { workspaceId })
  else if (html.trimStart().startsWith('---'))
    html =
      '<!DOCTYPE html><html><head><meta name="sim-artifact"><title>Page</title></head><body></body></html>'
  const headInjection = [
    '<meta charset="utf-8">',
    `<base href="${HTML_PREVIEW_BASE_URL}">`,
    `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`,
    usesSimArtifactStyles(html)
      ? `<style>${SIM_ARTIFACT_STYLESHEET}</style><style>${simTokenOverrides(theme)}</style>${SIM_ARTIFACT_SHELL}`
      : '',
    HTML_PREVIEW_BOOTSTRAP,
  ].join('')
  if (/<head[\s>]/i.test(html))
    return stampTheme(
      html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${headInjection}`),
      theme
    )
  if (/<html[\s>]/i.test(html))
    return stampTheme(
      html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}<head>${headInjection}</head>`),
      theme
    )
  return `<!DOCTYPE html><html data-theme="${theme}"><head>${headInjection}</head><body>${html}</body></html>`
}

/** While a page streams in, srcdoc updates are batched so the growing page stays readable. */
function useStreamBatchedValue(value: string, streaming: boolean): string {
  const [batched, setBatched] = useState(value)
  const lastAppliedAtRef = useRef(0)
  useEffect(() => {
    if (!streaming) {
      lastAppliedAtRef.current = 0
      setBatched(value)
      return
    }
    const elapsed = Date.now() - lastAppliedAtRef.current
    if (elapsed >= STREAM_BATCH_MS) {
      lastAppliedAtRef.current = Date.now()
      setBatched(value)
      return
    }
    const timer = setTimeout(() => {
      lastAppliedAtRef.current = Date.now()
      setBatched(value)
    }, STREAM_BATCH_MS - elapsed)
    return () => clearTimeout(timer)
  }, [value, streaming])
  return streaming ? batched : value
}

const WORKSPACE_IMAGE_SRC = /src="(\/api\/files\/view\/[^"]+)"/g

/**
 * The sandboxed frame has no cookies, so a workspace image would answer 401 inside it. The host
 * fetches each with its own session and hands the frame a data URI, which the frame's opaque
 * origin can still draw.
 */
function useInlinedWorkspaceImages(content: string): string {
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const cacheRef = useRef<Map<string, string> | null>(null)
  cacheRef.current ??= new Map()
  useEffect(() => {
    const cache = cacheRef.current
    if (!cache) return
    const urls = [...content.matchAll(WORKSPACE_IMAGE_SRC)].map((match) => match[1])
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
          setResolved((previous) => ({ ...previous, [url]: dataUri }))
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [content])
  return useMemo(
    () =>
      content.replace(WORKSPACE_IMAGE_SRC, (match, url: string) => {
        const dataUri = cacheRef.current?.get(url) ?? resolved[url]
        return dataUri ? `src="${dataUri}"` : match
      }),
    [content, resolved]
  )
}

interface HtmlPreviewProps {
  content: string
  isStreaming?: boolean
  workspaceId: string
  fileId: string
  fileKey: string
}

function HtmlPreview({ content, isStreaming, workspaceId, fileId, fileKey }: HtmlPreviewProps) {
  const theme = useResolvedTheme()
  const router = useRouter()
  const batched = useStreamBatchedValue(content, isStreaming === true)
  /**
   * A saved Sim page prefers the server-compiled document, which resolves chart references against
   * the table's current rows and inlines the chart runtime. The client compile stands in while it
   * loads, and always while the page is being edited.
   */
  const isSavedPage = isStreaming !== true && isSimPageSource(content)
  const served = useWorkspaceFileBinary(workspaceId, fileId, fileKey, { enabled: isSavedPage })
  const servedHtml = useMemo(
    () => (isSavedPage && served.data ? new TextDecoder().decode(served.data) : null),
    [isSavedPage, served.data]
  )
  const built = buildHtmlPreviewDocument(servedHtml ?? batched, theme, workspaceId)
  const srcDoc = useInlinedWorkspaceImages(built)
  const containerRef = useRef<HTMLDivElement>(null)
  const [renderable, setRenderable] = useState(false)
  const [resumeNonce, setResumeNonce] = useState(0)

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const href = (event.data as { __simPageNav?: unknown } | null)?.__simPageNav
      if (typeof href !== 'string') return
      if (href.startsWith('/workspace/')) {
        router.push(href)
        return
      }
      if (!/^https?:\/\//i.test(href)) return
      try {
        const url = new URL(href)
        if (url.origin === window.location.origin && url.pathname.startsWith('/workspace/')) {
          router.push(`${url.pathname}${url.search}${url.hash}`)
          return
        }
      } catch {}
      window.open(href, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [router])

  /** A frame that mounts at zero size never paints, so it waits for its container to have one. */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    setRenderable(rect.width > 0 && rect.height > 0)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setRenderable(entry.contentRect.width > 0 && entry.contentRect.height > 0)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  /** A tab restored from the background (or the back-forward cache) gets a fresh frame. */
  useEffect(() => {
    let hidden = false
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hidden = true
      else if (hidden) {
        hidden = false
        setResumeNonce((nonce) => nonce + 1)
      }
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setResumeNonce((nonce) => nonce + 1)
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
    }
  }, [])

  return (
    <div ref={containerRef} className={styles.html}>
      {renderable && (
        <iframe
          key={resumeNonce}
          srcDoc={srcDoc}
          sandbox='allow-scripts'
          referrerPolicy='no-referrer'
          title='HTML preview'
          className={styles.frame}
        />
      )}
    </div>
  )
}

function SvgPreview({ content }: { content: string }) {
  const [blobUrl, setBlobUrl] = useState('')
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([content], { type: 'image/svg+xml' }))
    setBlobUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [content])
  return (
    <ZoomablePreview>
      {blobUrl && <img src={blobUrl} alt='SVG preview' draggable={false} />}
    </ZoomablePreview>
  )
}

interface CsvPreviewProps {
  content: string
  workspaceId: string
  file: { id: string; key: string; name: string }
}

function CsvPreview({ content, workspaceId, file }: CsvPreviewProps) {
  const scrollRef = useHorizontalWheelScroll()
  const { headers, rows, truncated } = useMemo(() => parseCsv(content), [content])
  useCsvTruncationImport(workspaceId, file, truncated)
  if (headers.length === 0)
    return (
      <p className={styles.empty} data-type='T060'>
        No data to display
      </p>
    )
  return (
    <div ref={scrollRef} className={styles.table}>
      <DataTable headers={headers} rows={rows} />
    </div>
  )
}

/** The first {@link CSV_PREVIEW_MAX_ROWS} rows; `truncated` offers the import as a table. */
function parseCsv(text: string): { headers: string[]; rows: string[][]; truncated: boolean } {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [], truncated: false }
  const delimiter = detectDelimiter(lines[0])
  const dataLines = lines.slice(1)
  return {
    headers: parseCsvLine(lines[0], delimiter),
    rows: dataLines.slice(0, CSV_PREVIEW_MAX_ROWS).map((line) => parseCsvLine(line, delimiter)),
    truncated: dataLines.length > CSV_PREVIEW_MAX_ROWS,
  }
}

function detectDelimiter(line: string): string {
  const commas = (line.match(/,/g) || []).length
  const tabs = (line.match(/\t/g) || []).length
  const semicolons = (line.match(/;/g) || []).length
  if (tabs > commas && tabs > semicolons) return '\t'
  if (semicolons > commas) return ';'
  return ','
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false
  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"'
          index++
        } else inQuotes = false
      } else current += char
    } else if (char === '"') inQuotes = true
    else if (char === delimiter) {
      fields.push(current.trim())
      current = ''
    } else current += char
  }
  fields.push(current.trim())
  return fields
}
