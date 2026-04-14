'use client'

import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useRouter } from 'next/navigation'
import rehypeSlug from 'rehype-slug'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import { Checkbox } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import { DataTable } from './data-table'

interface HastNode {
  position?: { start?: { offset?: number } }
}

type PreviewType = 'markdown' | 'html' | 'csv' | 'svg' | null

const PREVIEWABLE_MIME_TYPES: Record<string, PreviewType> = {
  'text/markdown': 'markdown',
  'text/html': 'html',
  'text/csv': 'csv',
  'image/svg+xml': 'svg',
}

const PREVIEWABLE_EXTENSIONS: Record<string, PreviewType> = {
  md: 'markdown',
  html: 'html',
  htm: 'html',
  csv: 'csv',
  svg: 'svg',
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
  isStreaming?: boolean
  onCheckboxToggle?: (checkboxIndex: number, checked: boolean) => void
}

export const PreviewPanel = memo(function PreviewPanel({
  content,
  mimeType,
  filename,
  isStreaming,
  onCheckboxToggle,
}: PreviewPanelProps) {
  const previewType = resolvePreviewType(mimeType, filename)

  if (previewType === 'markdown')
    return (
      <MarkdownPreview
        content={content}
        isStreaming={isStreaming}
        onCheckboxToggle={onCheckboxToggle}
      />
    )
  if (previewType === 'html') return <HtmlPreview content={content} />
  if (previewType === 'csv') return <CsvPreview content={content} />
  if (previewType === 'svg') return <SvgPreview content={content} />

  return null
})

const REMARK_PLUGINS = [remarkGfm, remarkBreaks]
const REHYPE_PLUGINS = [rehypeSlug]

/**
 * Carries the contentRef and toggle handler from MarkdownPreview down to the
 * task-list renderers. Only present when the preview is interactive.
 */
const MarkdownCheckboxCtx = createContext<{
  contentRef: React.MutableRefObject<string>
  onToggle: (index: number, checked: boolean) => void
} | null>(null)

/** Carries the resolved checkbox index from LiRenderer to InputRenderer. */
const CheckboxIndexCtx = createContext(-1)

const NavigateCtx = createContext<((path: string) => void) | null>(null)

const STATIC_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className='mb-3 break-words text-[14px] text-[var(--text-primary)] leading-[1.6] last:mb-0'>
      {children}
    </p>
  ),
  h1: ({ id, children }: { id?: string; children?: React.ReactNode }) => (
    <h1
      id={id}
      className='mt-6 mb-4 break-words font-semibold text-[24px] text-[var(--text-primary)] first:mt-0'
    >
      {children}
    </h1>
  ),
  h2: ({ id, children }: { id?: string; children?: React.ReactNode }) => (
    <h2
      id={id}
      className='mt-5 mb-3 break-words font-semibold text-[20px] text-[var(--text-primary)] first:mt-0'
    >
      {children}
    </h2>
  ),
  h3: ({ id, children }: { id?: string; children?: React.ReactNode }) => (
    <h3
      id={id}
      className='mt-4 mb-2 break-words font-semibold text-[16px] text-[var(--text-primary)] first:mt-0'
    >
      {children}
    </h3>
  ),
  h4: ({ id, children }: { id?: string; children?: React.ReactNode }) => (
    <h4
      id={id}
      className='mt-3 mb-2 break-words font-semibold text-[14px] text-[var(--text-primary)] first:mt-0'
    >
      {children}
    </h4>
  ),
  inlineCode: ({ children }: { children?: React.ReactNode }) => {
    if (typeof children === 'string' && children.includes('\n')) {
      return (
        <code className='my-4 block overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-5)] p-4 font-mono text-[13px] text-[var(--text-primary)] leading-[1.6]'>
          {children}
        </code>
      )
    }
    return (
      <code className='whitespace-normal rounded bg-[var(--surface-5)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--caution)]'>
        {children}
      </code>
    )
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className='break-words font-semibold text-[var(--text-primary)]'>{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className='break-words text-[var(--text-tertiary)]'>{children}</em>
  ),
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className='my-4 break-words border-[var(--border-1)] border-l-4 py-1 pl-4 text-[var(--text-tertiary)] italic'>
      {children}
    </blockquote>
  ),
  hr: () => <hr className='my-6 border-[var(--border)]' />,
  img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img
      src={src as string}
      alt={alt ?? ''}
      className='my-3 max-w-full rounded-md'
      loading='lazy'
    />
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className='my-4 max-w-full overflow-x-auto'>
      <table className='w-full border-collapse text-[13px]'>{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className='bg-[var(--surface-2)]'>{children}</thead>
  ),
  tbody: ({ children }: { children?: React.ReactNode }) => <tbody>{children}</tbody>,
  tr: ({ children }: { children?: React.ReactNode }) => (
    <tr className='border-[var(--border)] border-b last:border-b-0'>{children}</tr>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className='px-3 py-2 text-left font-semibold text-[12px] text-[var(--text-primary)]'>
      {children}
    </th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className='px-3 py-2 text-[var(--text-secondary)]'>{children}</td>
  ),
}

function UlRenderer({ className, children }: { className?: string; children?: React.ReactNode }) {
  const isTaskList = typeof className === 'string' && className.includes('contains-task-list')
  return (
    <ul
      className={cn(
        'mt-1 mb-3 space-y-1 break-words text-[14px] text-[var(--text-primary)]',
        isTaskList ? 'list-none pl-0' : 'list-disc pl-6'
      )}
    >
      {children}
    </ul>
  )
}

function OlRenderer({ className, children }: { className?: string; children?: React.ReactNode }) {
  const isTaskList = typeof className === 'string' && className.includes('contains-task-list')
  return (
    <ol
      className={cn(
        'mt-1 mb-3 space-y-1 break-words text-[14px] text-[var(--text-primary)]',
        isTaskList ? 'list-none pl-0' : 'list-decimal pl-6'
      )}
    >
      {children}
    </ol>
  )
}

function LiRenderer({
  className,
  children,
  node,
}: {
  className?: string
  children?: React.ReactNode
  node?: HastNode
}) {
  const ctx = useContext(MarkdownCheckboxCtx)
  const isTaskItem = typeof className === 'string' && className.includes('task-list-item')

  if (isTaskItem) {
    if (ctx) {
      const offset = node?.position?.start?.offset
      if (offset === undefined) {
        return <li className='flex items-start gap-2 break-words leading-[1.6]'>{children}</li>
      }
      const before = ctx.contentRef.current.slice(0, offset)
      const prior = before.match(/^(\s*(?:[-*+]|\d+[.)]) +)\[([ xX])\]/gm)
      return (
        <CheckboxIndexCtx.Provider value={prior ? prior.length : 0}>
          <li className='flex items-start gap-2 break-words leading-[1.6]'>{children}</li>
        </CheckboxIndexCtx.Provider>
      )
    }
    return <li className='flex items-start gap-2 break-words leading-[1.6]'>{children}</li>
  }

  return <li className='break-words leading-[1.6]'>{children}</li>
}

function InputRenderer({ type, checked, ...props }: React.ComponentPropsWithoutRef<'input'>) {
  const ctx = useContext(MarkdownCheckboxCtx)
  const index = useContext(CheckboxIndexCtx)

  if (type !== 'checkbox') return <input type={type} checked={checked} {...props} />

  const isInteractive = ctx !== null && index >= 0

  return (
    <Checkbox
      checked={checked ?? false}
      onCheckedChange={
        isInteractive ? (newChecked) => ctx.onToggle(index, Boolean(newChecked)) : undefined
      }
      disabled={!isInteractive}
      size='sm'
      className='mt-1 shrink-0'
    />
  )
}

function isInternalHref(
  href: string,
  origin = window.location.origin
): { pathname: string; hash: string } | null {
  if (href.startsWith('#')) return { pathname: '', hash: href }
  try {
    const url = new URL(href, origin)
    if (url.origin === origin && url.pathname.startsWith('/workspace/')) {
      return { pathname: url.pathname, hash: url.hash }
    }
  } catch {
    if (href.startsWith('/workspace/')) {
      const hashIdx = href.indexOf('#')
      if (hashIdx === -1) return { pathname: href, hash: '' }
      return { pathname: href.slice(0, hashIdx), hash: href.slice(hashIdx) }
    }
  }
  return null
}

function AnchorRenderer({ href, children }: { href?: string; children?: React.ReactNode }) {
  const navigate = useContext(NavigateCtx)
  const parsed = useMemo(() => (href ? isInternalHref(href) : null), [href])

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (!parsed || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      e.preventDefault()

      if (parsed.pathname === '' && parsed.hash) {
        const el = document.getElementById(parsed.hash.slice(1))
        if (el) {
          const container = el.closest('.overflow-auto') as HTMLElement | null
          if (container) {
            container.scrollTo({ top: el.offsetTop - container.offsetTop, behavior: 'smooth' })
          } else {
            el.scrollIntoView({ behavior: 'smooth' })
          }
        }
        return
      }

      const destination = parsed.pathname + parsed.hash
      if (navigate) {
        navigate(destination)
      } else {
        window.location.assign(destination)
      }
    },
    [parsed, navigate]
  )

  return (
    <a
      href={href}
      target={parsed ? undefined : '_blank'}
      rel={parsed ? undefined : 'noopener noreferrer'}
      onClick={handleClick}
      className='break-all text-[var(--brand-secondary)] underline-offset-2 hover:underline'
    >
      {children}
    </a>
  )
}

const MARKDOWN_COMPONENTS = {
  ...STATIC_MARKDOWN_COMPONENTS,
  a: AnchorRenderer,
  ul: UlRenderer,
  ol: OlRenderer,
  li: LiRenderer,
  input: InputRenderer,
}

const MarkdownPreview = memo(function MarkdownPreview({
  content,
  isStreaming = false,
  onCheckboxToggle,
}: {
  content: string
  isStreaming?: boolean
  onCheckboxToggle?: (checkboxIndex: number, checked: boolean) => void
}) {
  const { push: navigate } = useRouter()
  const { ref: autoScrollRef } = useAutoScroll(isStreaming)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const contentRef = useRef(content)
  contentRef.current = content

  const ctxValue = useMemo(
    () => (onCheckboxToggle ? { contentRef, onToggle: onCheckboxToggle } : null),
    [onCheckboxToggle]
  )
  const setScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node
      autoScrollRef(node)
    },
    [autoScrollRef]
  )

  const hasScrolledToHash = useRef(false)
  useEffect(() => {
    const hash = window.location.hash
    if (!hash || hasScrolledToHash.current) return
    const id = hash.slice(1)
    const el = document.getElementById(id)
    if (!el) return
    hasScrolledToHash.current = true
    const container = el.closest('.overflow-auto') as HTMLElement | null
    if (container) {
      container.scrollTo({ top: el.offsetTop - container.offsetTop, behavior: 'smooth' })
    } else {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }, [content])

  const streamdownMode = isStreaming ? undefined : 'static'

  if (onCheckboxToggle) {
    return (
      <NavigateCtx.Provider value={navigate}>
        <MarkdownCheckboxCtx.Provider value={ctxValue}>
          <div ref={setScrollRef} className='h-full overflow-auto p-6'>
            <Streamdown
              mode={streamdownMode}
              remarkPlugins={REMARK_PLUGINS}
              rehypePlugins={REHYPE_PLUGINS}
              components={MARKDOWN_COMPONENTS}
            >
              {content}
            </Streamdown>
          </div>
        </MarkdownCheckboxCtx.Provider>
      </NavigateCtx.Provider>
    )
  }

  return (
    <NavigateCtx.Provider value={navigate}>
      <div ref={setScrollRef} className='h-full overflow-auto p-6'>
        <Streamdown
          mode={streamdownMode}
          remarkPlugins={REMARK_PLUGINS}
          rehypePlugins={REHYPE_PLUGINS}
          components={MARKDOWN_COMPONENTS}
        >
          {content}
        </Streamdown>
      </div>
    </NavigateCtx.Provider>
  )
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
  // Run inline HTML/JS in an isolated iframe while blocking any navigation
  // that would replace the preview with another document.
  const wrappedContent = useMemo(() => buildHtmlPreviewDocument(content), [content])
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
          className='h-full w-full border-0 bg-white'
        />
      )}
    </div>
  )
})

const SvgPreview = memo(function SvgPreview({ content }: { content: string }) {
  const wrappedContent = useMemo(
    () =>
      `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:transparent;}svg{max-width:100%;max-height:100vh;}</style></head><body>${content}</body></html>`,
    [content]
  )

  return (
    <div className='h-full overflow-hidden'>
      <iframe
        srcDoc={wrappedContent}
        sandbox=''
        title='SVG Preview'
        className='h-full w-full border-0'
      />
    </div>
  )
})

const CsvPreview = memo(function CsvPreview({ content }: { content: string }) {
  const { headers, rows } = useMemo(() => parseCsv(content), [content])

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

function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }

  const delimiter = detectDelimiter(lines[0])
  const headers = parseCsvLine(lines[0], delimiter)
  const rows = lines.slice(1).map((line) => parseCsvLine(line, delimiter))

  return { headers, rows }
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
