'use client'

import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react'
import matter from 'gray-matter'
import { useRouter } from 'next/navigation'
import rehypeSlug from 'rehype-slug'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import { toError } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { Checkbox, CopyCodeButton, highlight, languages } from '@/components/emcn'
import '@/components/emcn/components/code/code.css'
import 'prismjs/components/prism-bash'
import 'prismjs/components/prism-css'
import 'prismjs/components/prism-markup'
import 'prismjs/components/prism-javascript'
import 'prismjs/components/prism-typescript'
import 'prismjs/components/prism-yaml'
import 'prismjs/components/prism-sql'
import 'prismjs/components/prism-python'
import { cn } from '@/lib/core/utils/cn'
import { extractTextContent } from '@/lib/core/utils/react-node-text'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import { DataTable } from './data-table'

interface HastNode {
  position?: { start?: { offset?: number } }
}

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
  if (previewType === 'mermaid') return <MermaidFilePreview content={content} />

  return null
})

const CALLOUT_TYPES = new Set(['NOTE', 'TIP', 'WARNING', 'IMPORTANT', 'CAUTION'])

function remarkCallouts() {
  return (tree: { type: string; children?: unknown[] }) => {
    function processNode(node: { type: string; children?: unknown[] }) {
      if (!node.children) return
      for (const child of node.children) {
        processNode(child as { type: string; children?: unknown[] })
        const c = child as {
          type: string
          children?: unknown[]
          data?: { hName?: string; hProperties?: Record<string, string> }
        }
        if (c.type !== 'blockquote') continue
        const first = (c.children?.[0] ?? null) as {
          type: string
          children?: unknown[]
        } | null
        if (!first || first.type !== 'paragraph') continue
        const firstText = (first.children?.[0] ?? null) as {
          type: string
          value?: string
        } | null
        if (!firstText || firstText.type !== 'text' || !firstText.value) continue
        const match = firstText.value.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT|CAUTION)\]\s?/i)
        if (!match) continue
        const calloutType = match[1].toUpperCase()
        if (!CALLOUT_TYPES.has(calloutType)) continue

        c.data ??= {}
        c.data.hProperties = { ...(c.data.hProperties ?? {}), 'data-callout': calloutType }

        const remainder = firstText.value.slice(match[0].length)
        if (remainder) {
          firstText.value = remainder
        } else if (first.children && first.children.length === 1) {
          c.children?.shift()
        } else {
          first.children?.shift()
        }
      }
    }
    processNode(tree)
  }
}

const REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkCallouts]
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

const CALLOUT_CONFIG: Record<
  string,
  { label: string; borderColor: string; bgColor: string; textColor: string; iconColor: string }
> = {
  NOTE: {
    label: 'Note',
    borderColor: 'border-blue-400/60',
    bgColor: 'bg-blue-400/10',
    textColor: 'text-[var(--text-primary)]',
    iconColor: 'text-blue-500',
  },
  TIP: {
    label: 'Tip',
    borderColor: 'border-emerald-400/60',
    bgColor: 'bg-emerald-400/10',
    textColor: 'text-[var(--text-primary)]',
    iconColor: 'text-emerald-500',
  },
  WARNING: {
    label: 'Warning',
    borderColor: 'border-amber-400/60',
    bgColor: 'bg-amber-400/10',
    textColor: 'text-[var(--text-primary)]',
    iconColor: 'text-amber-500',
  },
  IMPORTANT: {
    label: 'Important',
    borderColor: 'border-violet-400/60',
    bgColor: 'bg-violet-400/10',
    textColor: 'text-[var(--text-primary)]',
    iconColor: 'text-violet-500',
  },
  CAUTION: {
    label: 'Caution',
    borderColor: 'border-red-400/60',
    bgColor: 'bg-red-400/10',
    textColor: 'text-[var(--text-primary)]',
    iconColor: 'text-red-500',
  },
}

const CALLOUT_ICONS: Record<string, string> = {
  NOTE: 'ℹ',
  TIP: '💡',
  WARNING: '⚠',
  IMPORTANT: '❕',
  CAUTION: '🛑',
}

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  sh: 'bash',
  shell: 'bash',
  html: 'markup',
  xml: 'markup',
  yml: 'yaml',
  py: 'python',
}

function CalloutBlock({ type, children }: { type: string; children?: React.ReactNode }) {
  const config = CALLOUT_CONFIG[type]
  if (!config) {
    return (
      <blockquote className='my-4 break-words border-[var(--border-1)] border-l-4 py-1 pl-4 text-[var(--text-tertiary)] italic'>
        {children}
      </blockquote>
    )
  }
  return (
    <div
      className={cn(
        'my-4 rounded-lg border-l-4 px-4 py-3 text-[14px]',
        config.borderColor,
        config.bgColor
      )}
    >
      <div
        className={cn('mb-1 flex items-center gap-1.5 font-semibold text-[13px]', config.iconColor)}
      >
        <span>{CALLOUT_ICONS[type]}</span>
        <span>{config.label}</span>
      </div>
      <div className={cn('break-words leading-[1.6]', config.textColor)}>{children}</div>
    </div>
  )
}

const MermaidDiagram = memo(function MermaidDiagram({ definition }: { definition: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const idRef = useRef(`mermaid-${generateShortId(8)}`)

  useEffect(() => {
    if (typeof window === 'undefined') return
    let cancelled = false

    async function render() {
      try {
        const { default: mermaid } = await import('mermaid')
        if (cancelled) return

        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: 'default',
        })

        const { svg: rendered } = await mermaid.render(idRef.current, definition.trim())
        if (!cancelled) {
          setSvg(rendered)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(toError(err).message || 'Failed to render diagram')
          setSvg(null)
        }
      }
    }

    setSvg(null)
    setError(null)
    render()
    return () => {
      cancelled = true
    }
  }, [definition])

  if (error) {
    return (
      <div className='my-4 rounded-lg border border-[var(--border)] p-4 text-[13px] text-[var(--text-muted)]'>
        <span className='font-medium text-[var(--text-body)]'>Diagram error: </span>
        {error}
      </div>
    )
  }

  if (!svg) {
    return <div className='my-4 h-[100px] animate-pulse rounded-lg bg-[var(--surface-2)]' />
  }

  return <div className='my-4 overflow-auto rounded-lg' dangerouslySetInnerHTML={{ __html: svg }} />
})

const STATIC_MARKDOWN_COMPONENTS = {
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
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
  h5: ({ id, children }: { id?: string; children?: React.ReactNode }) => (
    <h5
      id={id}
      className='mt-3 mb-1 break-words font-semibold text-[13px] text-[var(--text-primary)] first:mt-0'
    >
      {children}
    </h5>
  ),
  h6: ({ id, children }: { id?: string; children?: React.ReactNode }) => (
    <h6
      id={id}
      className='mt-3 mb-1 break-words font-medium text-[12px] text-[var(--text-secondary)] first:mt-0'
    >
      {children}
    </h6>
  ),
  inlineCode: ({ children }: { children?: React.ReactNode }) => {
    if (typeof children === 'string' && children.includes('\n')) {
      return (
        <code className='my-4 block overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-5)] p-4 font-mono text-[var(--text-primary)] leading-[1.6]'>
          {children}
        </code>
      )
    }
    return (
      <code className='whitespace-normal rounded bg-[var(--surface-5)] px-1.5 py-0.5 font-mono text-[var(--caution)]'>
        {children}
      </code>
    )
  },
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const langMatch = className?.match(/language-(\w+)/)
    const langRaw = langMatch?.[1] ?? ''
    const codeString = extractTextContent(children)

    if (langRaw === 'mermaid') {
      return <MermaidDiagram definition={codeString} />
    }

    if (!codeString) {
      return (
        <code className='whitespace-normal rounded bg-[var(--surface-5)] px-1.5 py-0.5 font-mono text-[var(--caution)]'>
          {children}
        </code>
      )
    }

    const resolved = LANG_ALIASES[langRaw] || langRaw || 'javascript'
    const grammar = languages[resolved] || languages.javascript
    const html = grammar ? highlight(codeString.trimEnd(), grammar, resolved) : null

    return (
      <div className='my-4 overflow-hidden rounded-lg border border-[var(--border)]'>
        <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-3)] px-3 py-1.5'>
          <span className='text-[11px] text-[var(--text-tertiary)]'>{langRaw || 'code'}</span>
          <CopyCodeButton
            code={codeString}
            className='-mr-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
          />
        </div>
        <div className='code-editor-theme bg-[var(--surface-5)]'>
          {html ? (
            <pre
              className='m-0 overflow-x-auto whitespace-pre p-4 font-mono text-[13px] leading-[1.6]'
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <pre className='m-0 overflow-x-auto whitespace-pre p-4 font-mono text-[13px] text-[var(--text-primary)] leading-[1.6]'>
              <code>{codeString.trimEnd()}</code>
            </pre>
          )}
        </div>
      </div>
    )
  },
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className='break-words font-semibold'>{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => <em className='break-words'>{children}</em>,
  del: ({ children }: { children?: React.ReactNode }) => (
    <del className='line-through opacity-50'>{children}</del>
  ),
  blockquote: ({
    children,
    'data-callout': calloutType,
  }: {
    children?: React.ReactNode
    'data-callout'?: string
  }) => {
    if (calloutType && CALLOUT_TYPES.has(calloutType)) {
      return <CalloutBlock type={calloutType}>{children}</CalloutBlock>
    }
    return (
      <blockquote className='my-4 break-words border-[var(--border-1)] border-l-4 py-1 pl-4 text-[var(--text-tertiary)] italic'>
        {children}
      </blockquote>
    )
  },
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
  const parsed = href ? isInternalHref(href) : null

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
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
  }

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

function FrontMatterCard({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return null

  return (
    <div className='mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-[13px]'>
      <dl className='flex flex-col gap-1.5'>
        {entries.map(([key, value]) => (
          <div key={key} className='flex gap-2 break-words'>
            <dt className='shrink-0 font-medium text-[var(--text-secondary)]'>{key}:</dt>
            <dd className='text-[var(--text-primary)]'>
              {Array.isArray(value)
                ? value.join(', ')
                : value instanceof Date
                  ? value.toISOString().split('T')[0]
                  : String(value ?? '')}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
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

  const contentRef = useRef(content)
  contentRef.current = content

  const { frontMatterData, markdownContent } = useMemo(() => {
    if (isStreaming) return { frontMatterData: null, markdownContent: content }
    try {
      const parsed = matter(content)
      const hasFrontMatter = Object.keys(parsed.data).length > 0
      return {
        frontMatterData: hasFrontMatter ? parsed.data : null,
        markdownContent: hasFrontMatter ? parsed.content : content,
      }
    } catch {
      return { frontMatterData: null, markdownContent: content }
    }
  }, [content, isStreaming])

  const ctxValue = useMemo(
    () => (onCheckboxToggle ? { contentRef, onToggle: onCheckboxToggle } : null),
    [onCheckboxToggle]
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

  const body = (
    <div ref={autoScrollRef} className='h-full overflow-auto p-6'>
      {frontMatterData && <FrontMatterCard data={frontMatterData} />}
      <Streamdown
        mode={streamdownMode}
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {markdownContent}
      </Streamdown>
    </div>
  )

  return (
    <NavigateCtx.Provider value={navigate}>
      {onCheckboxToggle ? (
        <MarkdownCheckboxCtx.Provider value={ctxValue}>{body}</MarkdownCheckboxCtx.Provider>
      ) : (
        body
      )}
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
  const wrappedContent = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:transparent;}svg{max-width:100%;max-height:100vh;}</style></head><body>${content}</body></html>`

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
}

function MermaidFilePreview({ content }: { content: string }) {
  return (
    <div className='h-full overflow-auto p-6'>
      <MermaidDiagram definition={content} />
    </div>
  )
}

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
