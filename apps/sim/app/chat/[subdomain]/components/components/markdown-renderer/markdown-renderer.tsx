import ReactMarkdown from 'react-markdown'

export default function MarkdownRenderer({ content }: { content: string }) {
  const customComponents = {
    // Paragraph
    p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p className='mt-0.5 mb-1 text-base leading-normal'>{children}</p>
    ),

    // Headings
    h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className='mt-3 mb-1 font-semibold text-xl'>{children}</h1>
    ),
    h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className='mt-3 mb-1 font-semibold text-lg'>{children}</h2>
    ),
    h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className='mt-3 mb-1 font-semibold text-base'>{children}</h3>
    ),
    h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h4 className='mt-3 mb-1 font-semibold text-sm'>{children}</h4>
    ),

    // Lists
    ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className='my-1 list-disc space-y-0.5 pl-5'>{children}</ul>
    ),
    ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol className='my-1 list-decimal space-y-0.5 pl-5'>{children}</ol>
    ),
    li: ({ children }: React.HTMLAttributes<HTMLLIElement>) => (
      <li className='text-base'>{children}</li>
    ),

    // Code blocks
    pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => (
      <pre className='my-2 overflow-x-auto rounded-md bg-gray-100 p-3 font-mono text-sm dark:bg-gray-800'>
        {children}
      </pre>
    ),

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
            className='rounded-md bg-gray-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-gray-800'
            {...props}
          >
            {children}
          </code>
        )
      }

      // Extract language from className (format: language-xxx)
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''

      return (
        <div className='relative'>
          {language && (
            <div className='absolute top-1 right-2 text-gray-500 text-xs dark:text-gray-400'>
              {language}
            </div>
          )}
          <code className={className} {...props}>
            {children}
          </code>
        </div>
      )
    },

    // Blockquotes
    blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote className='my-2 border-gray-200 border-l-4 py-0 pl-4 text-gray-700 italic dark:border-gray-700 dark:text-gray-300'>
        <div className='flex items-center py-0'>{children}</div>
      </blockquote>
    ),

    // Horizontal rule
    hr: () => <hr className='my-3 border-gray-200 dark:border-gray-700' />,

    // Links
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        className='text-blue-600 hover:underline dark:text-blue-400'
        target='_blank'
        rel='noopener noreferrer'
        {...props}
      >
        {children}
      </a>
    ),

    // Tables
    table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
      <div className='my-2 overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700'>
        <table className='w-full border-collapse'>{children}</table>
      </div>
    ),
    thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <thead className='border-gray-200 border-b bg-gray-50 dark:border-gray-700 dark:bg-gray-800'>
        {children}
      </thead>
    ),
    tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <tbody className='divide-y divide-gray-200 bg-white dark:divide-gray-700 dark:bg-gray-900'>
        {children}
      </tbody>
    ),
    tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
      <tr className='transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60' {...props}>
        {children}
      </tr>
    ),
    th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
      <th className='px-4 py-3 text-left font-medium text-gray-500 text-xs uppercase tracking-wider dark:text-gray-300'>
        {children}
      </th>
    ),
    td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
      <td className='border-0 px-4 py-3 text-sm'>{children}</td>
    ),

    // Images
    img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img
        src={src}
        alt={alt || 'Image'}
        className='my-2 h-auto max-w-full rounded-md'
        {...props}
      />
    ),
  }

  // Process text to clean up unnecessary whitespace and formatting issues
  const processedContent = content
    .replace(/\n{2,}/g, '\n\n') // Replace multiple newlines with exactly double newlines
    .replace(/^(#{1,6})\s+(.+?)\n{2,}/gm, '$1 $2\n') // Reduce space after headings to single newline
    .trim()

  return (
    <div className='text-[#0D0D0D] text-base leading-normal dark:text-gray-100'>
      <ReactMarkdown components={customComponents}>{processedContent}</ReactMarkdown>
    </div>
  )
}
