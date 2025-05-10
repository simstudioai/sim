import ReactMarkdown from 'react-markdown'

export default function MarkdownRenderer({ content }: { content: string }) {
  const customComponents = {
    // Paragraph
    p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p className="mt-0.5 mb-1 text-base leading-normal">{children}</p>
    ),

    // Headings
    h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className="text-xl font-semibold mt-3 mb-1">{children}</h1>
    ),
    h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className="text-lg font-semibold mt-3 mb-1">{children}</h2>
    ),
    h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="text-base font-semibold mt-3 mb-1">{children}</h3>
    ),
    h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h4 className="text-sm font-semibold mt-3 mb-1">{children}</h4>
    ),

    // Lists
    ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>
    ),
    ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>
    ),
    li: ({ children }: React.HTMLAttributes<HTMLLIElement>) => (
      <li className="text-base">{children}</li>
    ),

    // Code blocks
    pre: ({ children }: React.HTMLAttributes<HTMLPreElement>) => (
      <pre className="bg-gray-100 dark:bg-gray-800 my-2 p-3 rounded-md overflow-x-auto text-sm font-mono">
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
            className="text-[0.9em] bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded-md font-mono"
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
        <div className="relative">
          {language && (
            <div className="absolute right-2 top-1 text-xs text-gray-500 dark:text-gray-400">
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
      <blockquote className="border-l-4 border-gray-200 dark:border-gray-700 pl-4 py-0 my-2 italic text-gray-700 dark:text-gray-300">
        <div className="py-0 flex items-center">{children}</div>
      </blockquote>
    ),

    // Horizontal rule
    hr: () => <hr className="my-3 border-gray-200 dark:border-gray-700" />,

    // Links
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        className="text-blue-600 dark:text-blue-400 hover:underline"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    ),

    // Tables
    table: ({ children }: React.TableHTMLAttributes<HTMLTableElement>) => (
      <div className="my-2 overflow-x-auto rounded-md border border-gray-200 dark:border-gray-700">
        <table className="w-full border-collapse">{children}</table>
      </div>
    ),
    thead: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        {children}
      </thead>
    ),
    tbody: ({ children }: React.HTMLAttributes<HTMLTableSectionElement>) => (
      <tbody className="divide-y divide-gray-200 dark:divide-gray-700 bg-white dark:bg-gray-900">
        {children}
      </tbody>
    ),
    tr: ({ children, ...props }: React.HTMLAttributes<HTMLTableRowElement>) => (
      <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors" {...props}>
        {children}
      </tr>
    ),
    th: ({ children }: React.ThHTMLAttributes<HTMLTableCellElement>) => (
      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-300 uppercase tracking-wider">
        {children}
      </th>
    ),
    td: ({ children }: React.TdHTMLAttributes<HTMLTableCellElement>) => (
      <td className="px-4 py-3 text-sm border-0">{children}</td>
    ),

    // Images
    img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <img
        src={src}
        alt={alt || 'Image'}
        className="max-w-full h-auto my-2 rounded-md"
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
    <div className="text-base leading-normal text-[#0D0D0D] dark:text-gray-100">
      <ReactMarkdown components={customComponents}>{processedContent}</ReactMarkdown>
    </div>
  )
}
