'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Code, Tooltip } from '@/components/emcn'

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

// Global layout fixes for markdown content inside the copilot panel
if (typeof document !== 'undefined') {
  const styleId = 'copilot-markdown-fix'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      /* Prevent any markdown content from expanding beyond the panel */
      .copilot-markdown-wrapper,
      .copilot-markdown-wrapper * {
        max-width: 100% !important;
      }

      .copilot-markdown-wrapper p,
      .copilot-markdown-wrapper li {
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }

      .copilot-markdown-wrapper a {
        overflow-wrap: anywhere !important;
        word-break: break-all !important;
      }

      .copilot-markdown-wrapper code:not(pre code) {
        white-space: normal !important;
        overflow-wrap: anywhere !important;
        word-break: break-word !important;
      }

      /* Reduce top margin for first heading (e.g., right after thinking block) */
      .copilot-markdown-wrapper > h1:first-child,
      .copilot-markdown-wrapper > h2:first-child,
      .copilot-markdown-wrapper > h3:first-child,
      .copilot-markdown-wrapper > h4:first-child {
        margin-top: 0.25rem !important;
      }
    `
    document.head.appendChild(style)
  }
}

/**
 * Link component with hover preview tooltip
 * Displays full URL on hover for better UX
 * @param props - Component props with href and children
 * @returns Link element with tooltip preview
 */
function LinkWithPreview({ href, children }: { href: string; children: React.ReactNode }) {
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
}

/**
 * Props for the CopilotMarkdownRenderer component
 */
interface CopilotMarkdownRendererProps {
  /** Markdown content to render */
  content: string
}

/**
 * CopilotMarkdownRenderer renders markdown content with custom styling
 * Supports GitHub-flavored markdown, code blocks with syntax highlighting,
 * tables, links with preview, and more
 *
 * @param props - Component props
 * @returns Rendered markdown content
 */
export default function CopilotMarkdownRenderer({ content }: CopilotMarkdownRendererProps) {
  const [copiedCodeBlocks, setCopiedCodeBlocks] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const timers: Record<string, NodeJS.Timeout> = {}

    Object.keys(copiedCodeBlocks).forEach((key) => {
      if (copiedCodeBlocks[key]) {
        timers[key] = setTimeout(() => {
          setCopiedCodeBlocks((prev) => ({ ...prev, [key]: false }))
        }, 2000)
      }
    })

    return () => {
      Object.values(timers).forEach(clearTimeout)
    }
  }, [copiedCodeBlocks])

  const markdownComponents = useMemo(
    () => ({
      p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
        <p className='mb-2 font-base font-season text-[var(--text-primary)] text-sm leading-[1.25rem] last:mb-0 dark:font-[470]'>
          {children}
        </p>
      ),

      h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h1 className='mt-3 mb-3 font-season font-semibold text-2xl text-[var(--text-primary)]'>
          {children}
        </h1>
      ),
      h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h2 className='mt-2.5 mb-2.5 font-season font-semibold text-[var(--text-primary)] text-xl'>
          {children}
        </h2>
      ),
      h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h3 className='mt-2 mb-2 font-season font-semibold text-[var(--text-primary)] text-lg'>
          {children}
        </h3>
      ),
      h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h4 className='mt-2 mb-2 font-season font-semibold text-[var(--text-primary)] text-base'>
          {children}
        </h4>
      ),

      ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
        <ul
          className='mt-1 mb-1 space-y-1.5 pl-6 font-base font-season text-[var(--text-primary)] dark:font-[470]'
          style={{ listStyleType: 'disc' }}
        >
          {children}
        </ul>
      ),
      ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
        <ol
          className='mt-1 mb-1 space-y-1.5 pl-6 font-base font-season text-[var(--text-primary)] dark:font-[470]'
          style={{ listStyleType: 'decimal' }}
        >
          {children}
        </ol>
      ),
      li: ({
        children,
        ordered,
      }: React.LiHTMLAttributes<HTMLLIElement> & { ordered?: boolean }) => (
        <li
          className='font-base font-season text-[var(--text-primary)] dark:font-[470]'
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

        const codeText = actualCodeText || 'code'
        const codeBlockKey = `${language}-${codeText.substring(0, 30).replace(/\s/g, '-')}-${codeText.length}`

        const showCopySuccess = copiedCodeBlocks[codeBlockKey] || false

        const handleCopy = () => {
          const textToCopy = actualCodeText
          if (textToCopy) {
            navigator.clipboard.writeText(textToCopy)
            setCopiedCodeBlocks((prev) => ({ ...prev, [codeBlockKey]: true }))
          }
        }

        const normalizedLanguage = (language || '').toLowerCase()
        const viewerLanguage: 'javascript' | 'json' | 'python' =
          normalizedLanguage === 'json'
            ? 'json'
            : normalizedLanguage === 'python' || normalizedLanguage === 'py'
              ? 'python'
              : 'javascript'

        return (
          <div className='mt-6 mb-6 w-0 min-w-full overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-1)] text-sm'>
            <div className='flex items-center justify-between border-[var(--border-1)] border-b px-4 py-1.5'>
              <span className='font-season text-[var(--text-muted)] text-xs'>
                {language === 'code' ? viewerLanguage : language}
              </span>
              <button
                onClick={handleCopy}
                className='text-[var(--text-muted)] transition-colors hover:text-[var(--text-tertiary)]'
                title='Copy'
              >
                {showCopySuccess ? (
                  <Check className='h-3 w-3' strokeWidth={2} />
                ) : (
                  <Copy className='h-3 w-3' strokeWidth={2} />
                )}
              </button>
            </div>
            <Code.Viewer
              code={actualCodeText.replace(/\n+$/, '')}
              showGutter
              language={viewerLanguage}
              className='m-0 min-h-0 rounded-none border-0 bg-transparent'
            />
          </div>
        )
      },

      code: ({
        inline,
        className,
        children,
        ...props
      }: React.HTMLAttributes<HTMLElement> & { className?: string; inline?: boolean }) => {
        if (inline) {
          return (
            <code
              className='whitespace-normal break-all rounded border border-[var(--border-1)] bg-[var(--surface-1)] px-1 py-0.5 font-mono text-[0.9em] text-[var(--text-primary)]'
              {...props}
            >
              {children}
            </code>
          )
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        )
      },

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
        <blockquote className='my-4 border-[var(--border-1)] border-l-4 py-1 pl-4 font-season text-[var(--text-secondary)] italic'>
          {children}
        </blockquote>
      ),

      hr: () => <hr className='my-8 border-[var(--divider)] border-t' />,

      a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <LinkWithPreview href={href || '#'} {...props}>
          {children}
        </LinkWithPreview>
      ),

      table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
        <div className='my-4 max-w-full overflow-x-auto'>
          <table className='min-w-full table-auto border border-[var(--border-1)] font-season text-sm'>
            {children}
          </table>
        </div>
      ),
      thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
        <thead className='bg-[var(--surface-5)] text-left dark:bg-[var(--surface-4)]'>
          {children}
        </thead>
      ),
      tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
        <tbody className='divide-y divide-[var(--border-1)]'>{children}</tbody>
      ),
      tr: ({ children }: React.HTMLAttributes<HTMLTableRowElement>) => (
        <tr className='border-[var(--border-1)] border-b transition-colors hover:bg-[var(--surface-5)] dark:hover:bg-[var(--surface-4)]/60'>
          {children}
        </tr>
      ),
      th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
        <th className='border-[var(--border-1)] border-r px-4 py-2 align-top font-base text-[var(--text-secondary)] last:border-r-0 dark:font-[470]'>
          {children}
        </th>
      ),
      td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
        <td className='break-words border-[var(--border-1)] border-r px-4 py-2 align-top font-base text-[var(--text-primary)] last:border-r-0 dark:font-[470]'>
          {children}
        </td>
      ),

      img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
        <img
          src={src}
          alt={alt || 'Image'}
          className='my-3 h-auto max-w-full rounded-md'
          {...props}
        />
      ),
    }),
    [copiedCodeBlocks]
  )

  return (
    <div className='copilot-markdown-wrapper max-w-full space-y-3 break-words font-base font-season text-[var(--text-primary)] text-sm leading-[1.25rem] dark:font-[470]'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
