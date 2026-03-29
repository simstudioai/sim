'use client'

import { createContext, memo, useContext, useMemo, useRef } from 'react'
import type { Components, ExtraProps } from 'react-markdown'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import { Checkbox } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { getFileExtension } from '@/lib/uploads/utils/file-utils'
import { useAutoScroll } from '@/hooks/use-auto-scroll'
import { useStreamingReveal } from '@/hooks/use-streaming-reveal'

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

const STATIC_MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className='mb-3 break-words text-[14px] text-[var(--text-primary)] leading-[1.6] last:mb-0'>
      {children}
    </p>
  ),
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className='mt-6 mb-4 break-words font-semibold text-[24px] text-[var(--text-primary)] first:mt-0'>
      {children}
    </h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className='mt-5 mb-3 break-words font-semibold text-[20px] text-[var(--text-primary)] first:mt-0'>
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className='mt-4 mb-2 break-words font-semibold text-[16px] text-[var(--text-primary)] first:mt-0'>
      {children}
    </h3>
  ),
  h4: ({ children }: { children?: React.ReactNode }) => (
    <h4 className='mt-3 mb-2 break-words font-semibold text-[14px] text-[var(--text-primary)] first:mt-0'>
      {children}
    </h4>
  ),
  code: ({
    className,
    children,
    node: _node,
    ...props
  }: React.HTMLAttributes<HTMLElement> & ExtraProps) => {
    const isInline = !className?.includes('language-')

    if (isInline) {
      return (
        <code
          {...props}
          className='whitespace-normal rounded bg-[var(--surface-5)] px-1.5 py-0.5 font-mono text-[13px] text-[var(--caution)]'
        >
          {children}
        </code>
      )
    }

    return (
      <code
        {...props}
        className='my-3 block whitespace-pre-wrap break-words rounded-md bg-[var(--surface-5)] p-4 font-mono text-[13px] text-[var(--text-primary)]'
      >
        {children}
      </code>
    )
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a
      href={href}
      target='_blank'
      rel='noopener noreferrer'
      className='break-all text-[var(--brand-secondary)] underline-offset-2 hover:underline'
    >
      {children}
    </a>
  ),
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
  img: ({ src, alt, node: _node }: React.ComponentPropsWithoutRef<'img'> & ExtraProps) => (
    <img src={src} alt={alt ?? ''} className='my-3 max-w-full rounded-md' loading='lazy' />
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

function UlRenderer({ className, children }: React.ComponentPropsWithoutRef<'ul'> & ExtraProps) {
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

function OlRenderer({ className, children }: React.ComponentPropsWithoutRef<'ol'> & ExtraProps) {
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
}: React.ComponentPropsWithoutRef<'li'> & ExtraProps) {
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

function InputRenderer({
  type,
  checked,
  node: _node,
  ...props
}: React.ComponentPropsWithoutRef<'input'> & ExtraProps) {
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

const MARKDOWN_COMPONENTS = {
  ...STATIC_MARKDOWN_COMPONENTS,
  ul: UlRenderer,
  ol: OlRenderer,
  li: LiRenderer,
  input: InputRenderer,
} satisfies Components

const MarkdownPreview = memo(function MarkdownPreview({
  content,
  isStreaming = false,
  onCheckboxToggle,
}: {
  content: string
  isStreaming?: boolean
  onCheckboxToggle?: (checkboxIndex: number, checked: boolean) => void
}) {
  const { ref: scrollRef } = useAutoScroll(isStreaming)
  const { committed, incoming, generation } = useStreamingReveal(content, isStreaming)

  const contentRef = useRef(content)
  contentRef.current = content

  const ctxValue = useMemo(
    () => (onCheckboxToggle ? { contentRef, onToggle: onCheckboxToggle } : null),
    [onCheckboxToggle]
  )

  const committedMarkdown = useMemo(
    () =>
      committed ? (
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
          {committed}
        </ReactMarkdown>
      ) : null,
    [committed]
  )

  if (onCheckboxToggle) {
    return (
      <MarkdownCheckboxCtx.Provider value={ctxValue}>
        <div ref={scrollRef} className='h-full overflow-auto p-6'>
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {content}
          </ReactMarkdown>
        </div>
      </MarkdownCheckboxCtx.Provider>
    )
  }

  return (
    <div ref={scrollRef} className='h-full overflow-auto p-6'>
      {committedMarkdown}
      {incoming && (
        <div
          key={generation}
          className={cn(isStreaming && 'animate-stream-fade-in', '[&>:first-child]:mt-0')}
        >
          <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
            {incoming}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
})

const HtmlPreview = memo(function HtmlPreview({ content }: { content: string }) {
  return (
    <div className='h-full overflow-hidden'>
      <iframe
        srcDoc={content}
        sandbox='allow-same-origin'
        title='HTML Preview'
        className='h-full w-full border-0 bg-white'
      />
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
      <div className='overflow-x-auto rounded-md border border-[var(--border)]'>
        <table className='w-full border-collapse text-[13px]'>
          <thead className='bg-[var(--surface-2)]'>
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className='whitespace-nowrap px-3 py-2 text-left font-semibold text-[12px] text-[var(--text-primary)]'
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={ri} className='border-[var(--border)] border-t'>
                {headers.map((_, ci) => (
                  <td key={ci} className='whitespace-nowrap px-3 py-2 text-[var(--text-secondary)]'>
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
