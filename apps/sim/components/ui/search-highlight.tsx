'use client'

interface SearchHighlightProps {
  text: string
  searchQuery: string
  className?: string
}

export function SearchHighlight({ text, searchQuery, className = '' }: SearchHighlightProps) {
  if (!searchQuery.trim()) {
    return <span className={className}>{text}</span>
  }

  // Create regex pattern for all search terms
  const searchTerms = searchQuery
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))

  if (searchTerms.length === 0) {
    return <span className={className}>{text}</span>
  }

  const regex = new RegExp(`(${searchTerms.join('|')})`, 'gi')
  const parts = text.split(regex)

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (!part) return null

        const isMatch = searchTerms.some((term) => new RegExp(term, 'gi').test(part))

        return isMatch ? (
          <span
            key={index}
            className='bg-yellow-200 text-yellow-900 dark:bg-yellow-900/50 dark:text-yellow-200'
          >
            {part}
          </span>
        ) : (
          <span key={index}>{part}</span>
        )
      })}
    </span>
  )
}
