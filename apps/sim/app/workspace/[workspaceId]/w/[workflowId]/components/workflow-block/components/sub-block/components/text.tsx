interface TextProps {
  blockId: string
  subBlockId: string
  content: string
  className?: string
}

export function Text({ blockId, subBlockId, content, className }: TextProps) {
  const containsHtml = /<[^>]+>/.test(content)

  if (containsHtml) {
    return (
      <div
        id={`${blockId}-${subBlockId}`}
        className={`rounded-md border bg-card p-4 shadow-sm ${className || ''}`}
      >
        <div
          className='prose prose-sm dark:prose-invert max-w-none text-sm [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_strong]:font-semibold [&_ul]:ml-5 [&_ul]:list-disc'
          dangerouslySetInnerHTML={{ __html: content }}
        />
      </div>
    )
  }

  return (
    <div
      id={`${blockId}-${subBlockId}`}
      className={`whitespace-pre-wrap rounded-md border bg-card p-4 text-muted-foreground text-sm shadow-sm ${className || ''}`}
    >
      {content}
    </div>
  )
}
