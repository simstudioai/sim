import React, { type HTMLAttributes, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '@/components/emcn'

function LinkWithPreview({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <a
          href={href}
          className='font-mono text-blue-600 text-sm underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300'
          target='_blank'
          rel='noopener noreferrer'
        >
          {children}
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content side='top' align='center' sideOffset={5} className='max-w-sm p-3'>
        <span className='truncate font-medium text-xs'>{href}</span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export default function LogMarkdownRenderer({ content }: { content: string }) {
  // Minimal content processing - just trim whitespace
  const processedContent = content.trim()

  const customComponents = {
    // Paragraph with appropriate spacing for logs
    p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p className='mb-3 font-mono text-gray-800 text-sm leading-relaxed last:mb-0 dark:text-gray-200'>
        {children}
      </p>
    ),

    // Headings with subtle styling
    h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className='mt-5 mb-3 font-mono font-semibold text-base text-gray-900 dark:text-gray-100'>
        {children}
      </h1>
    ),
    h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className='mt-4 mb-2 font-mono font-semibold text-gray-900 text-sm dark:text-gray-100'>
        {children}
      </h2>
    ),
    h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className='mt-4 mb-2 font-mono font-semibold text-gray-900 text-sm dark:text-gray-100'>
        {children}
      </h3>
    ),
    h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h4 className='mt-3 mb-1 font-mono font-semibold text-gray-900 text-sm dark:text-gray-100'>
        {children}
      </h4>
    ),

    // Lists with proper spacing
    ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul
        className='mb-3 space-y-1 pl-4 font-mono text-gray-800 text-sm dark:text-gray-200'
        style={{ listStyleType: 'disc' }}
      >
        {children}
      </ul>
    ),
    ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol
        className='mb-3 space-y-1 pl-4 font-mono text-gray-800 text-sm dark:text-gray-200'
        style={{ listStyleType: 'decimal' }}
      >
        {children}
      </ol>
    ),
    li: ({ children }: React.LiHTMLAttributes<HTMLLIElement>) => (
      <li
        className='font-mono text-gray-800 text-sm dark:text-gray-200'
        style={{ display: 'list-item' }}
      >
        {children}
      </li>
    ),

    // Code blocks with subtle background
    pre: ({ children }: HTMLAttributes<HTMLPreElement>) => {
      let codeProps: HTMLAttributes<HTMLElement> = {}
      let codeContent: ReactNode = children

      if (
        React.isValidElement<{ className?: string; children?: ReactNode }>(children) &&
        children.type === 'code'
      ) {
        const childElement = children as React.ReactElement<{
          className?: string
          children?: ReactNode
        }>
        codeProps = { className: childElement.props.className }
        codeContent = childElement.props.children
      }

      return (
        <div className='my-4 rounded bg-gray-100 text-sm dark:bg-gray-800'>
          <div className='flex items-center justify-between border-gray-200 border-b px-3 py-1 dark:border-gray-700'>
            <span className='font-mono text-gray-500 text-xs dark:text-gray-400'>
              {codeProps.className?.replace('language-', '') || 'code'}
            </span>
          </div>
          <pre className='overflow-x-auto p-3 font-mono text-gray-800 text-sm dark:text-gray-200'>
            {codeContent}
          </pre>
        </div>
      )
    },

    // Inline code with subtle background
    code: ({
      inline,
      className,
      children,
      ...props
    }: React.HTMLAttributes<HTMLElement> & { className?: string; inline?: boolean }) => {
      if (inline) {
        return (
          <code
            className='rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-800 text-sm dark:bg-gray-700 dark:text-gray-200'
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

    // Blockquotes
    blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote className='my-3 border-gray-300 border-l-2 py-1 pl-3 font-mono text-gray-700 text-sm italic dark:border-gray-600 dark:text-gray-300'>
        {children}
      </blockquote>
    ),

    // Horizontal rule
    hr: () => <hr className='my-5 border-gray-500/[.15] border-t dark:border-gray-400/[.15]' />,

    // Links with hover effect and preview
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <LinkWithPreview href={href || '#'} {...props}>
        {children}
      </LinkWithPreview>
    ),

    // Tables
    table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
      <div className='my-4 w-full overflow-x-auto'>
        <table className='min-w-full table-auto border border-gray-300 font-mono text-sm dark:border-gray-700'>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <thead className='bg-gray-50 text-left dark:bg-gray-800'>{children}</thead>
    ),
    tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <tbody className='divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900'>
        {children}
      </tbody>
    ),
    tr: ({ children }: React.HTMLAttributes<HTMLTableRowElement>) => (
      <tr className='border-gray-200 border-b dark:border-gray-700'>{children}</tr>
    ),
    th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
      <th className='border-gray-300 border-r px-2 py-1 font-medium text-gray-700 text-xs last:border-r-0 dark:border-gray-700 dark:text-gray-300'>
        {children}
      </th>
    ),
    td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
      <td className='break-words border-gray-300 border-r px-2 py-1 text-gray-800 text-xs last:border-r-0 dark:border-gray-700 dark:text-gray-200'>
        {children}
      </td>
    ),

    // Images
    img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img src={src} alt={alt || 'Image'} className='my-3 h-auto max-w-full rounded' {...props} />
    ),
  }

  return (
    <div className='break-words font-mono text-gray-800 text-sm leading-relaxed dark:text-gray-200'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={customComponents}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
