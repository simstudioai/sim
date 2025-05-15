import ReactMarkdown from 'react-markdown'

export default function LogMarkdownRenderer({ content }: { content: string }) {
  // Process text to clean up unnecessary whitespace and formatting issues
  const processedContent = content
    .replace(/\n{2,}/g, '\n\n') // Replace multiple newlines with exactly double newlines
    .replace(/^(#{1,6})\s+(.+?)\n{2,}/gm, '$1 $2\n') // Reduce space after headings to single newline
    .replace(/^(#{1,6}.+)\n\n(-|\*)/gm, '$1\n$2') // Remove double newline between heading and list
    .trim()

  const customComponents = {
    // Default component to ensure monospace font with minimal spacing
    p: ({ children }: React.HTMLAttributes<HTMLParagraphElement>) => (
      <p className="whitespace-pre-wrap font-mono text-sm leading-tight my-0.5">{children}</p>
    ),

    // Inline code - no background to maintain clean appearance
    code: ({
      inline,
      className,
      children,
      ...props
    }: React.HTMLAttributes<HTMLElement> & { className?: string; inline?: boolean }) => {
      return (
        <code className="font-mono text-sm" {...props}>
          {children}
        </code>
      )
    },

    // Links - maintain monospace while adding subtle link styling
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        className="font-mono text-sm text-blue-600 dark:text-blue-400 hover:underline"
        target="_blank"
        rel="noopener noreferrer"
        {...props}
      >
        {children}
      </a>
    ),

    // Tighter lists with minimal spacing
    ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className="list-disc pl-5 font-mono text-sm -mt-1.5 mb-1 leading-none">{children}</ul>
    ),
    ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol className="list-decimal pl-5 font-mono text-sm -mt-1.5 mb-1 leading-none">{children}</ol>
    ),
    li: ({ children }: React.HTMLAttributes<HTMLLIElement>) => (
      <li className="font-mono text-sm mb-0 leading-tight">{children}</li>
    ),

    // Keep blockquotes minimal
    blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote className="font-mono text-sm my-0">{children}</blockquote>
    ),

    // Make headings compact with minimal spacing after
    h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className="font-mono text-sm font-medium mt-2 mb-0">{children}</h1>
    ),
    h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className="font-mono text-sm font-medium mt-2 mb-0">{children}</h2>
    ),
    h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className="font-mono text-sm font-medium mt-1.5 mb-0">{children}</h3>
    ),
    h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h4 className="font-mono text-sm font-medium mt-1.5 mb-0">{children}</h4>
    ),
  }

  return (
    <div className="text-sm whitespace-pre-wrap w-full overflow-visible font-mono leading-tight [&>ul]:mt-0 [&>h2+ul]:-mt-2.5 [&>h3+ul]:-mt-2.5">
      <ReactMarkdown components={customComponents}>{processedContent}</ReactMarkdown>
    </div>
  )
}
