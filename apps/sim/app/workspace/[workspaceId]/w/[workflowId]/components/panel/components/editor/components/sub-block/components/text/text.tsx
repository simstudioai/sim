/**
 * Props for the Text component
 */
interface TextProps {
  /** Unique identifier for the block */
  blockId: string
  /** Unique identifier for the sub-block */
  subBlockId: string
  /** Text or HTML content to display */
  content: string
  /** Additional CSS classes to apply */
  className?: string
}

/**
 * Text display component with HTML rendering support
 *
 * @remarks
 * - Automatically detects and renders HTML content safely
 * - Applies consistent styling for HTML content (links, code, lists, etc.)
 * - Falls back to plain text rendering for non-HTML content
 *
 * Note: This component renders trusted, internally-defined content only
 * (e.g., trigger setup instructions). It is NOT used for user-generated content.
 */
export function Text({ blockId, subBlockId, content, className }: TextProps) {
  const containsHtml = /<[^>]+>/.test(content)

  if (containsHtml) {
    return (
      <div
        id={`${blockId}-${subBlockId}`}
        className={`rounded-md border bg-[var(--surface-2)] p-4 shadow-sm ${className || ''}`}
      >
        <div
          className='max-w-none break-words text-[var(--text-secondary)] text-sm [&_a]:text-[var(--brand-secondary)] [&_a]:underline [&_a]:underline-offset-2 [&_a]:hover:brightness-110 [&_code]:rounded [&_code]:bg-[var(--surface-5)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[var(--text-tertiary)] [&_code]:text-xs [&_strong]:font-medium [&_strong]:text-[var(--text-primary)] [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:marker:text-[var(--text-muted)]'
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    )
  }

  return (
    <div
      id={`${blockId}-${subBlockId}`}
      className={`whitespace-pre-wrap break-words rounded-md border bg-[var(--surface-2)] p-4 text-[var(--text-secondary)] text-sm shadow-sm ${className || ''}`}
    >
      {content}
    </div>
  )
}
