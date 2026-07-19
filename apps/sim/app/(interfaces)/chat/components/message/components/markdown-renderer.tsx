import React, { type HTMLAttributes, memo, type ReactNode } from 'react'
import { Streamdown } from 'streamdown'
import 'streamdown/styles.css'
import { CopyCodeButton, Tooltip } from '@sim/emcn'
import { extractTextContent } from '@/lib/core/utils/react-node-text'

function LinkWithPreview({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Tooltip.Root delayDuration={300}>
      <Tooltip.Trigger asChild>
        <a
          href={href}
          className='text-[var(--text-primary)] underline decoration-dashed underline-offset-4'
          target='_blank'
          rel='noopener noreferrer'
        >
          {children}
        </a>
      </Tooltip.Trigger>
      <Tooltip.Content side='top' align='center' sideOffset={5} className='max-w-sm'>
        <span className='truncate font-medium text-xs'>{href}</span>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

const COMPONENTS = {
  p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p className='mb-1 font-sans text-[var(--text-primary)] text-base leading-relaxed last:mb-0'>
      {children}
    </p>
  ),

  h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 className='mt-10 mb-5 font-sans font-semibold text-2xl text-[var(--text-primary)]'>
      {children}
    </h1>
  ),
  h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 className='mt-8 mb-4 font-sans font-semibold text-[var(--text-primary)] text-xl'>
      {children}
    </h2>
  ),
  h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 className='mt-7 mb-3 font-sans font-semibold text-[var(--text-primary)] text-lg'>
      {children}
    </h3>
  ),
  h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4 className='mt-5 mb-2 font-sans font-semibold text-[var(--text-primary)] text-base'>
      {children}
    </h4>
  ),

  ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
    <ul
      className='mt-1 mb-1 space-y-1 pl-6 font-sans text-[var(--text-primary)]'
      style={{ listStyleType: 'disc' }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
    <ol
      className='mt-1 mb-1 space-y-1 pl-6 font-sans text-[var(--text-primary)]'
      style={{ listStyleType: 'decimal' }}
    >
      {children}
    </ol>
  ),
  li: ({ children }: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li className='font-sans text-[var(--text-primary)]' style={{ display: 'list-item' }}>
      {children}
    </li>
  ),

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
      <div className='my-6 overflow-hidden rounded-lg border border-[var(--divider)] text-sm'>
        <div className='flex items-center justify-between border-[var(--divider)] border-b bg-[var(--surface-4)] px-4 py-1.5'>
          <span className='font-sans text-[var(--text-tertiary)] text-xs'>
            {codeProps.className?.replace('language-', '') || 'code'}
          </span>
          <CopyCodeButton
            code={extractTextContent(codeContent)}
            className='text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-secondary)]'
          />
        </div>
        <pre className='overflow-x-auto bg-[var(--surface-5)] p-4 font-mono text-[var(--text-primary)]'>
          {codeContent}
        </pre>
      </div>
    )
  },

  inlineCode: ({ children }: { children?: React.ReactNode }) => (
    <code className='rounded bg-[var(--surface-5)] px-1 py-0.5 font-mono text-[var(--text-primary)] text-inherit'>
      {children}
    </code>
  ),

  blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
    <blockquote className='my-4 break-words border-[var(--divider)] border-l-2 pl-4 font-sans text-[var(--text-primary)] italic [&>p:first-child]:mt-0 [&>p:last-child]:mb-0 [&>p]:my-2'>
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
    <div className='my-4 w-full overflow-x-auto'>
      <table className='min-w-full table-auto border border-[var(--border)] font-sans text-sm'>
        {children}
      </table>
    </div>
  ),
  thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <thead className='bg-[var(--surface-3)] text-left'>{children}</thead>
  ),
  tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
    <tbody className='divide-y divide-[var(--divider)] bg-[var(--surface-2)]'>{children}</tbody>
  ),
  tr: ({ children }: React.HTMLAttributes<HTMLTableRowElement>) => (
    <tr className='border-[var(--divider)] border-b transition-colors hover:bg-[var(--surface-hover)]'>
      {children}
    </tr>
  ),
  th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th className='border-[var(--border)] border-r px-4 py-2 font-medium text-[var(--text-secondary)] last:border-r-0'>
      {children}
    </th>
  ),
  td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td className='break-words border-[var(--border)] border-r px-4 py-2 text-[var(--text-body)] last:border-r-0'>
      {children}
    </td>
  ),

  img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
    <img src={src} alt={alt || 'Image'} className='my-3 h-auto max-w-full rounded-md' {...props} />
  ),
}

const MarkdownRenderer = memo(function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className='space-y-4 break-words font-sans text-[var(--text-primary)] text-base leading-relaxed'>
      <Streamdown mode='static' components={COMPONENTS}>
        {content.trim()}
      </Streamdown>
    </div>
  )
})

export default MarkdownRenderer
