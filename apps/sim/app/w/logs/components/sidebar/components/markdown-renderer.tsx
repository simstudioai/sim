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
      <p className='my-0.5 whitespace-pre-wrap font-mono text-sm leading-tight'>{children}</p>
    ),

    // Inline code - no background to maintain clean appearance
    code: ({
      inline,
      className,
      children,
      ...props
    }: React.HTMLAttributes<HTMLElement> & { className?: string; inline?: boolean }) => {
      return (
        <code className='font-mono text-sm' {...props}>
          {children}
        </code>
      )
    },

    // Links - maintain monospace while adding subtle link styling
    a: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a
        href={href}
        className='font-mono text-blue-600 text-sm hover:underline dark:text-blue-400'
        target='_blank'
        rel='noopener noreferrer'
        {...props}
      >
        {children}
      </a>
    ),

    // Tighter lists with minimal spacing
    ul: ({ children }: React.HTMLAttributes<HTMLUListElement>) => (
      <ul className='-mt-1.5 mb-1 list-disc pl-5 font-mono text-sm leading-none'>{children}</ul>
    ),
    ol: ({ children }: React.HTMLAttributes<HTMLOListElement>) => (
      <ol className='-mt-1.5 mb-1 list-decimal pl-5 font-mono text-sm leading-none'>{children}</ol>
    ),
    li: ({ children }: React.HTMLAttributes<HTMLLIElement>) => (
      <li className='mb-0 font-mono text-sm leading-tight'>{children}</li>
    ),

    // Keep blockquotes minimal
    blockquote: ({ children }: React.HTMLAttributes<HTMLQuoteElement>) => (
      <blockquote className='my-0 font-mono text-sm'>{children}</blockquote>
    ),

    // Make headings compact with minimal spacing after
    h1: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h1 className='mt-2 mb-0 font-medium font-mono text-sm'>{children}</h1>
    ),
    h2: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h2 className='mt-2 mb-0 font-medium font-mono text-sm'>{children}</h2>
    ),
    h3: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h3 className='mt-1.5 mb-0 font-medium font-mono text-sm'>{children}</h3>
    ),
    h4: ({ children }: React.HTMLAttributes<HTMLHeadingElement>) => (
      <h4 className='mt-1.5 mb-0 font-medium font-mono text-sm'>{children}</h4>
    ),
  }

  return (
    <div className='[&>h2+ul]:-mt-2.5 [&>h3+ul]:-mt-2.5 w-full overflow-visible whitespace-pre-wrap font-mono text-sm leading-tight [&>ul]:mt-0'>
      <ReactMarkdown components={customComponents}>{processedContent}</ReactMarkdown>
    </div>
  )
}
