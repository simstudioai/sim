'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

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

// Fix for code block text rendering issues
if (typeof document !== 'undefined') {
  const styleId = 'copilot-markdown-fix'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      .copilot-markdown-wrapper pre {
        color: #e5e7eb !important;
        font-weight: 400 !important;
        text-shadow: none !important;
        filter: none !important;
        opacity: 1 !important;
        -webkit-font-smoothing: antialiased !important;
        -moz-osx-font-smoothing: grayscale !important;
        text-rendering: optimizeLegibility !important;
        max-width: 100% !important;
        overflow: auto !important;
      }
      
      .dark .copilot-markdown-wrapper pre {
        color: #f3f4f6 !important;
      }
      
      .copilot-markdown-wrapper pre code,
      .copilot-markdown-wrapper pre code *,
      .copilot-markdown-wrapper pre span,
      .copilot-markdown-wrapper pre div {
        color: inherit !important;
        opacity: 1 !important;
        font-weight: 400 !important;
        text-shadow: none !important;
        filter: none !important;
        -webkit-font-smoothing: antialiased !important;
        -moz-osx-font-smoothing: grayscale !important;
        text-rendering: optimizeLegibility !important;
      }

      /* Prevent any markdown content from expanding beyond the panel */
      .copilot-markdown-wrapper, .copilot-markdown-wrapper * {
        max-width: 100% !important;
      }
      .copilot-markdown-wrapper p, .copilot-markdown-wrapper li {
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

// Link component with preview
function LinkWithPreview({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <a
          href={href}
          className='inline break-all text-blue-600 hover:underline dark:text-blue-400'
          target='_blank'
          rel='noopener noreferrer'
        >
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent side='top' align='center' sideOffset={5} className='max-w-sm p-3'>
        <span className='text-sm'>{href}</span>
      </TooltipContent>
    </Tooltip>
  )
}

interface CopilotMarkdownRendererProps {
  content: string
}

export default function CopilotMarkdownRenderer({ content }: CopilotMarkdownRendererProps) {
  const [copiedCodeBlocks, setCopiedCodeBlocks] = useState<Record<string, boolean>>({})

  // Reset copy success state after 2 seconds
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

  // Custom components for react-markdown with current styling - memoized to prevent re-renders
  const markdownComponents = useMemo(
    () => ({
      // Paragraph
      p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
        <p className='mb-1 font-geist-sans text-base text-gray-800 leading-relaxed last:mb-0 dark:text-gray-200'>
          {children}
        </p>
      ),

      // Headings
      h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h1 className='mt-3 mb-3 font-geist-sans font-semibold text-2xl text-gray-900 dark:text-gray-100'>
          {children}
        </h1>
      ),
      h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h2 className='mt-2.5 mb-2.5 font-geist-sans font-semibold text-gray-900 text-xl dark:text-gray-100'>
          {children}
        </h2>
      ),
      h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h3 className='mt-2 mb-2 font-geist-sans font-semibold text-gray-900 text-lg dark:text-gray-100'>
          {children}
        </h3>
      ),
      h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
        <h4 className='mt-5 mb-2 font-geist-sans font-semibold text-base text-gray-900 dark:text-gray-100'>
          {children}
        </h4>
      ),

      // Lists
      ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
        <ul
          className='mt-1 mb-1 space-y-1 pl-6 font-geist-sans text-gray-800 dark:text-gray-200'
          style={{ listStyleType: 'disc' }}
        >
          {children}
        </ul>
      ),
      ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
        <ol
          className='mt-1 mb-1 space-y-1 pl-6 font-geist-sans text-gray-800 dark:text-gray-200'
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
          className='font-geist-sans text-gray-800 dark:text-gray-200'
          style={{ display: 'list-item' }}
        >
          {children}
        </li>
      ),

      // Code blocks
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

        // Extract actual text content
        let actualCodeText = ''
        if (typeof codeContent === 'string') {
          actualCodeText = codeContent
        } else if (React.isValidElement(codeContent)) {
          // If it's a React element, try to get its text content
          actualCodeText = getTextContent(codeContent)
        } else if (Array.isArray(codeContent)) {
          // If it's an array of elements, join their text content
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

        // Create a unique key for this code block based on content
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

        return (
          <div className='my-6 w-0 min-w-full rounded-md bg-gray-900 text-sm dark:bg-black'>
            <div className='flex items-center justify-between border-gray-700 border-b px-4 py-1.5 dark:border-gray-800'>
              <span className='font-geist-sans text-gray-400 text-xs'>{language}</span>
              <button
                onClick={handleCopy}
                className='text-muted-foreground transition-colors hover:text-gray-300'
                title='Copy'
              >
                {showCopySuccess ? (
                  <Check className='h-3 w-3' strokeWidth={2} />
                ) : (
                  <Copy className='h-3 w-3' strokeWidth={2} />
                )}
              </button>
            </div>
            <div className='overflow-x-auto'>
              <pre className='whitespace-pre p-4 font-mono text-gray-100 text-sm leading-relaxed'>
                {actualCodeText}
              </pre>
            </div>
          </div>
        )
      },

      // Inline code
      code: ({
        inline,
        className,
        children,
        ...props
      }: React.HTMLAttributes<HTMLElement> & { className?: string; inline?: boolean }) => {
        if (inline) {
          return (
            <code
              className='whitespace-normal break-all rounded bg-gray-200 px-1 py-0.5 font-mono text-[0.9em] text-gray-800 dark:bg-gray-700 dark:text-gray-200'
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

      // Bold text
      strong: ({ children }: React.HTMLAttributes<HTMLElement>) => (
        <strong className='font-semibold text-gray-900 dark:text-gray-100'>{children}</strong>
      ),

      // Bold text (alternative)
      b: ({ children }: React.HTMLAttributes<HTMLElement>) => (
        <b className='font-semibold text-gray-900 dark:text-gray-100'>{children}</b>
      ),

      // Italic text
      em: ({ children }: React.HTMLAttributes<HTMLElement>) => (
        <em className='text-gray-800 italic dark:text-gray-200'>{children}</em>
      ),

      // Italic text (alternative)
      i: ({ children }: React.HTMLAttributes<HTMLElement>) => (
        <i className='text-gray-800 italic dark:text-gray-200'>{children}</i>
      ),

      // Blockquotes
      blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
        <blockquote className='my-4 border-gray-300 border-l-4 py-1 pl-4 font-geist-sans text-gray-700 italic dark:border-gray-600 dark:text-gray-300'>
          {children}
        </blockquote>
      ),

      // Horizontal rule
      hr: () => <hr className='my-8 border-gray-500/[.07] border-t dark:border-gray-400/[.07]' />,

      // Links
      a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
        <LinkWithPreview href={href || '#'} {...props}>
          {children}
        </LinkWithPreview>
      ),

      // Tables
      table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
        <div className='my-4 max-w-full overflow-x-auto'>
          <table className='min-w-full table-auto border border-gray-300 font-geist-sans text-sm dark:border-gray-700'>
            {children}
          </table>
        </div>
      ),
      thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
        <thead className='bg-gray-100 text-left dark:bg-gray-800'>{children}</thead>
      ),
      tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
        <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>{children}</tbody>
      ),
      tr: ({ children }: React.HTMLAttributes<HTMLTableRowElement>) => (
        <tr className='border-gray-200 border-b transition-colors hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800/60'>
          {children}
        </tr>
      ),
      th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
        <th className='border-gray-300 border-r px-4 py-2 font-medium text-gray-700 last:border-r-0 dark:border-gray-700 dark:text-gray-300'>
          {children}
        </th>
      ),
      td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
        <td className='break-words border-gray-300 border-r px-4 py-2 text-gray-800 last:border-r-0 dark:border-gray-700 dark:text-gray-200'>
          {children}
        </td>
      ),

      // Images
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
    <div className='copilot-markdown-wrapper max-w-full space-y-4 break-words font-geist-sans text-[#0D0D0D] text-base leading-relaxed dark:text-gray-100'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
