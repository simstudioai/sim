'use client'

import React, { memo, useCallback, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Code, Tooltip } from '@/components/emcn'

const REMARK_PLUGINS = [remarkGfm]

/**
 * Recursively extracts text content from React elements
 * @param element - React node to extract text from
 * @returns Concatenated text content
 */
const getTextContent = (element: React.ReactNode): string => {
  if (typeof element === 'string') {
    return element
  }
  if (typeof element === 'number') {
    return String(element)
  }
  if (React.isValidElement(element)) {
    const elementProps = element.props as { children?: React.ReactNode }
    return getTextContent(elementProps.children)
  }
  if (Array.isArray(element)) {
    return element.map(getTextContent).join('')
  }
  return ''
}

/**
 * Maps common language aliases to supported viewer languages
 */
const LANGUAGE_MAP: Record<string, 'javascript' | 'json' | 'python'> = {
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  ts: 'javascript',
  typescript: 'javascript',
  tsx: 'javascript',
  json: 'json',
  python: 'python',
  py: 'python',
  code: 'javascript',
}

/**
 * Normalizes a language string to a supported viewer language
 */
function normalizeLanguage(lang: string): 'javascript' | 'json' | 'python' {
  const normalized = (lang || '').toLowerCase()
  return LANGUAGE_MAP[normalized] || 'javascript'
}

/**
 * Props for the CodeBlock component
 */
interface CodeBlockProps {
  /** Code content to display */
  code: string
  /** Language identifier from markdown */
  language: string
}

/**
 * CodeBlock component with isolated copy state
 * Prevents full markdown re-renders when copy button is clicked
 */
const CodeBlock = memo(function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    if (code) {
      navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [code])

  const viewerLanguage = normalizeLanguage(language)
  const displayLanguage = language === 'code' ? viewerLanguage : language

  return (
    <div className='mt-2.5 mb-2.5 w-0 min-w-full overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] text-sm'>
      <div className='flex items-center justify-between border-[var(--border-1)] border-b px-3 py-1'>
        <span className='font-season text-[var(--text-muted)] text-xs'>{displayLanguage}</span>
        <button
          onClick={handleCopy}
          className='text-[var(--text-muted)] transition-colors hover:text-[var(--text-tertiary)]'
          title='Copy'
          type='button'
        >
          {copied ? (
            <Check className='h-3 w-3' strokeWidth={2} />
          ) : (
            <Copy className='h-3 w-3' strokeWidth={2} />
          )}
        </button>
      </div>
      <Code.Viewer
        code={code.replace(/\n+$/, '')}
        showGutter
        language={viewerLanguage}
        className='m-0 min-h-0 rounded-none border-0 bg-transparent'
      />
    </div>
  )
})

/**
 * Link component with hover preview tooltip
 */
const LinkWithPreview = memo(function LinkWithPreview({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <a
          href={href}
          className='inline break-all text-blue-600 hover:underline dark:text-blue-400'
          target='_blank'
          rel='noopener noreferrer'
        >
          {children}
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content side='top' align='center' sideOffset={5} className='max-w-sm'>
        <span className='text-sm'>{href}</span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
})

/**
 * Props for the CopilotMarkdownRenderer component
 */
interface CopilotMarkdownRendererProps {
  /** Markdown content to render */
  content: string
}

/**
 * Static markdown component definitions - optimized for LLM chat spacing
 * Tighter spacing compared to traditional prose for better chat UX
 */
const markdownComponents = {
  p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className='mb-1.5 font-base font-season text-[var(--text-primary)] text-sm leading-[1.4] last:mb-0 dark:font-[470]'>
      {children}
    </p>
  ),

  h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className='mt-2 mb-1 font-season font-semibold text-[var(--text-primary)] text-base first:mt-0'>
      {children}
    </h1>
  ),
  h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className='mt-2 mb-1 font-season font-semibold text-[15px] text-[var(--text-primary)] first:mt-0'>
      {children}
    </h2>
  ),
  h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className='mt-1.5 mb-0.5 font-season font-semibold text-[var(--text-primary)] text-sm first:mt-0'>
      {children}
    </h3>
  ),
  h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4 className='mt-1.5 mb-0.5 font-season font-semibold text-[var(--text-primary)] text-sm first:mt-0'>
      {children}
    </h4>
  ),

  ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className='my-1 space-y-0.5 pl-5 font-base font-season text-[var(--text-primary)] dark:font-[470]'
      style={{ listStyleType: 'disc' }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className='my-1 space-y-0.5 pl-5 font-base font-season text-[var(--text-primary)] dark:font-[470]'
      style={{ listStyleType: 'decimal' }}
    >
      {children}
    </ol>
  ),
  li: ({ children }: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li
      className='font-base font-season text-[var(--text-primary)] text-sm leading-[1.4] dark:font-[470]'
      style={{ display: 'list-item' }}
    >
      {children}
    </li>
  ),

  pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => {
    let codeContent: React.ReactNode = children
    let language = 'code'

    if (
      React.isValidElement<{ className?: string; children?: React.ReactNode }>(children) &&
      children.type === 'code'
    ) {
      const childElement = children as React.ReactElement<{
        className?: string
        children?: React.ReactNode
      }>
      codeContent = childElement.props.children
      language = childElement.props.className?.replace('language-', '') || 'code'
    }

    let actualCodeText = ''
    if (typeof codeContent === 'string') {
      actualCodeText = codeContent
    } else if (React.isValidElement(codeContent)) {
      actualCodeText = getTextContent(codeContent)
    } else if (Array.isArray(codeContent)) {
      actualCodeText = codeContent
        .map((child) =>
          typeof child === 'string'
            ? child
            : React.isValidElement(child)
              ? getTextContent(child)
              : ''
        )
        .join('')
    } else {
      actualCodeText = String(codeContent || '')
    }

    return <CodeBlock code={actualCodeText} language={language} />
  },

  code: ({
    className,
    children,
    ...props
  }: React.HTMLAttributes<HTMLElement> & { className?: string }) => (
    <code
      className='whitespace-normal break-all rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-1 py-0.5 font-mono text-[0.85em] text-[var(--text-primary)]'
      {...props}
    >
      {children}
    </code>
  ),

  strong: ({ children }: React.HTMLAttributes<HTMLElement>) => (
    <strong className='font-semibold text-[var(--text-primary)]'>{children}</strong>
  ),
  b: ({ children }: React.HTMLAttributes<HTMLElement>) => (
    <b className='font-semibold text-[var(--text-primary)]'>{children}</b>
  ),
  em: ({ children }: React.HTMLAttributes<HTMLElement>) => (
    <em className='text-[var(--text-primary)] italic'>{children}</em>
  ),
  i: ({ children }: React.HTMLAttributes<HTMLElement>) => (
    <i className='text-[var(--text-primary)] italic'>{children}</i>
  ),

  blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className='my-1.5 border-[var(--border-1)] border-l-2 py-0.5 pl-3 font-season text-[var(--text-secondary)] text-sm italic'>
      {children}
    </blockquote>
  ),

  hr: () => <hr className='my-3 border-[var(--divider)] border-t' />,

  a: ({ href, children }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <LinkWithPreview href={href || '#'}>{children}</LinkWithPreview>
  ),

  table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className='my-2 max-w-full overflow-x-auto'>
      <table className='min-w-full table-auto border border-[var(--border-1)] font-season text-xs'>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className='bg-[var(--surface-5)] text-left dark:bg-[var(--surface-4)]'>{children}</thead>
  ),
  tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody className='divide-y divide-[var(--border-1)]'>{children}</tbody>
  ),
  tr: ({ children }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr className='border-[var(--border-1)] border-b'>{children}</tr>
  ),
  th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th className='border-[var(--border-1)] border-r px-2 py-1 align-top font-base text-[var(--text-secondary)] last:border-r-0 dark:font-[470]'>
      {children}
    </th>
  ),
  td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className='break-words border-[var(--border-1)] border-r px-2 py-1 align-top font-base text-[var(--text-primary)] last:border-r-0 dark:font-[470]'>
      {children}
    </td>
  ),

  img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img src={src} alt={alt || 'Image'} className='my-2 h-auto max-w-full rounded-md' {...props} />
  ),
}

/**
 * CopilotMarkdownRenderer renders markdown content with custom styling
 * Optimized for LLM chat: tight spacing, memoized components, isolated state
 *
 * @param props - Component props
 * @returns Rendered markdown content
 */
function CopilotMarkdownRenderer({ content }: CopilotMarkdownRendererProps) {
  return (
    <div className='max-w-full break-words font-base font-season text-[var(--text-primary)] text-sm leading-[1.4] dark:font-[470] [&_*]:max-w-full [&_a]:break-all [&_code:not(pre_code)]:break-words [&_li]:break-words [&_p]:break-words'>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

export default memo(CopilotMarkdownRenderer)
