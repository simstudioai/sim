import React, { type HTMLAttributes, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip } from '@/components/emcn'

export function LinkWithPreview({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <a
          href={href}
          className='text-blue-600 hover:underline dark:text-blue-400'
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

export default function MarkdownRenderer({
  content,
  customLinkComponent,
}: {
  content: string
  customLinkComponent?: typeof LinkWithPreview
}) {
  const LinkComponent = customLinkComponent || LinkWithPreview

  const customComponents = {
    // Paragraph
    p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p className='mb-1 font-sans text-base text-gray-800 leading-relaxed last:mb-0 dark:text-gray-200'>
        {children}
      </p>
    ),

    // Headings
    h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className='mt-10 mb-5 font-sans font-semibold text-2xl text-gray-900 dark:text-gray-100'>
        {children}
      </h1>
    ),
    h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className='mt-8 mb-4 font-sans font-semibold text-gray-900 text-xl dark:text-gray-100'>
        {children}
      </h2>
    ),
    h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className='mt-7 mb-3 font-sans font-semibold text-gray-900 text-lg dark:text-gray-100'>
        {children}
      </h3>
    ),
    h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h4 className='mt-5 mb-2 font-sans font-semibold text-base text-gray-900 dark:text-gray-100'>
        {children}
      </h4>
    ),

    // Lists
    ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul
        className='mt-1 mb-1 space-y-1 pl-6 font-sans text-gray-800 dark:text-gray-200'
        style={{ listStyleType: 'disc' }}
      >
        {children}
      </ul>
    ),
    ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol
        className='mt-1 mb-1 space-y-1 pl-6 font-sans text-gray-800 dark:text-gray-200'
        style={{ listStyleType: 'decimal' }}
      >
        {children}
      </ol>
    ),
    li: ({
      children,
      ordered,
      ...props
    }: React.LiHTMLAttributes<HTMLLIElement> & { ordered?: boolean }) => (
      <li className='font-sans text-gray-800 dark:text-gray-200' style={{ display: 'list-item' }}>
        {children}
      </li>
    ),

    // Code blocks
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
        <div className='my-6 rounded-md bg-gray-900 text-sm dark:bg-black'>
          <div className='flex items-center justify-between border-gray-700 border-b px-4 py-1.5 dark:border-gray-800'>
            <span className='font-sans text-gray-400 text-xs'>
              {codeProps.className?.replace('language-', '') || 'code'}
            </span>
          </div>
          <pre className='overflow-x-auto p-4 font-mono text-gray-200 dark:text-gray-100'>
            {codeContent}
          </pre>
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
            className='rounded bg-gray-200 px-1 py-0.5 font-mono text-[0.9em] text-gray-800 dark:bg-gray-700 dark:text-gray-200'
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
      <blockquote className='my-4 border-gray-300 border-l-4 py-1 pl-4 font-sans text-gray-700 italic dark:border-gray-600 dark:text-gray-300'>
        {children}
      </blockquote>
    ),

    // Horizontal rule
    hr: () => <hr className='my-8 border-gray-500/[.07] border-t dark:border-gray-400/[.07]' />,

    // Links
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <LinkComponent href={href || '#'} {...props}>
        {children}
      </LinkComponent>
    ),

    // Tables
    table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
      <div className='my-4 w-full overflow-x-auto'>
        <table className='min-w-full table-auto border border-gray-300 font-sans text-sm dark:border-gray-700'>
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <thead className='bg-gray-100 text-left dark:bg-gray-800'>{children}</thead>
    ),
    tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <tbody className='divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900'>
        {children}
      </tbody>
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
  }

  // Pre-process content to fix common issues
  const processedContent = content.trim()

  return (
    <div className='space-y-4 break-words font-sans text-[#0D0D0D] text-base leading-relaxed dark:text-gray-100'>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={customComponents}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
