import React, { HTMLAttributes, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function LinkWithPreview({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <a
          href={href}
          className="text-blue-600 dark:text-blue-400 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {children}
        </a>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" sideOffset={5} className="p-3 max-w-sm">
        <span className="font-medium text-xs truncate">{href}</span>
      </TooltipContent>
    </Tooltip>
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
      <p className="text-base text-gray-800 dark:text-gray-200 leading-relaxed font-geist-sans mb-1 last:mb-0">
        {children}
      </p>
    ),

    // Headings
    h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className="text-2xl font-semibold mt-10 mb-5 text-gray-900 dark:text-gray-100 font-geist-sans">
        {children}
      </h1>
    ),
    h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className="text-xl font-semibold mt-8 mb-4 text-gray-900 dark:text-gray-100 font-geist-sans">
        {children}
      </h2>
    ),
    h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="text-lg font-semibold mt-7 mb-3 text-gray-900 dark:text-gray-100 font-geist-sans">
        {children}
      </h3>
    ),
    h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h4 className="text-base font-semibold mt-5 mb-2 text-gray-900 dark:text-gray-100 font-geist-sans">
        {children}
      </h4>
    ),

    // Lists
    ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul
        className="pl-6 mt-1 mb-1 space-y-1 text-gray-800 dark:text-gray-200 font-geist-sans"
        style={{ listStyleType: 'disc' }}
      >
        {children}
      </ul>
    ),
    ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol
        className="pl-6 mt-1 mb-1 space-y-1 text-gray-800 dark:text-gray-200 font-geist-sans"
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
      <li
        className="text-gray-800 dark:text-gray-200 font-geist-sans"
        style={{ display: 'list-item' }}
      >
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
        <div className="bg-gray-900 dark:bg-black rounded-md my-6 text-sm">
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-700 dark:border-gray-800">
            <span className="text-xs text-gray-400 font-geist-sans">
              {codeProps.className?.replace('language-', '') || 'code'}
            </span>
          </div>
          <pre className="p-4 overflow-x-auto font-mono text-gray-200 dark:text-gray-100">
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
            className="text-[0.9em] bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-1 py-0.5 rounded font-mono"
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
      <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 py-1 my-4 italic text-gray-700 dark:text-gray-300 font-geist-sans">
        {children}
      </blockquote>
    ),

    // Horizontal rule
    hr: () => <hr className="my-8 border-t border-gray-500/[.07] dark:border-gray-400/[.07]" />,

    // Links
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <LinkComponent href={href || '#'} {...props}>
        {children}
      </LinkComponent>
    ),

    // Tables
    table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
      <div className="my-4 overflow-x-auto w-full">
        <table className="min-w-full border border-gray-300 dark:border-gray-700 text-sm font-geist-sans table-auto">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <thead className="bg-gray-100 dark:bg-gray-800 text-left">{children}</thead>
    ),
    tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
        {children}
      </tbody>
    ),
    tr: ({ children }: React.HTMLAttributes<HTMLTableRowElement>) => (
      <tr className="border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors">
        {children}
      </tr>
    ),
    th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
      <th className="px-4 py-2 font-medium text-gray-700 dark:text-gray-300 border-r border-gray-300 dark:border-gray-700 last:border-r-0">
        {children}
      </th>
    ),
    td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
      <td className="px-4 py-2 text-gray-800 dark:text-gray-200 border-r border-gray-300 dark:border-gray-700 last:border-r-0 break-words">
        {children}
      </td>
    ),

    // Images
    img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img
        src={src}
        alt={alt || 'Image'}
        className="max-w-full h-auto my-3 rounded-md"
        {...props}
      />
    ),
  }

  // Pre-process content to fix common issues
  const processedContent = content.trim()

  return (
    <div className="text-base text-[#0D0D0D] dark:text-gray-100 leading-relaxed break-words font-geist-sans space-y-4">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={customComponents}>
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
