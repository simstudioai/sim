'use client'

import { Fragment } from 'react'

interface SearchHighlightProps {
  text: string
  searchQuery: string
  className?: string
}

export function SearchHighlight({ text, searchQuery, className = '' }: SearchHighlightProps) {
  if (!searchQuery.trim()) {
    return <span className={className}>{text}</span>
  }

  // Create a regex to find matches (case-insensitive)
  // Handle multiple search terms separated by spaces
  const searchTerms = searchQuery
    .trim()
    .split(/\s+/)
    .filter((term) => term.length > 0)

  if (searchTerms.length === 0) {
    return <span className={className}>{text}</span>
  }

  // Create regex pattern for all search terms
  const escapedTerms = searchTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regexPattern = `(${escapedTerms.join('|')})`
  const regex = new RegExp(regexPattern, 'gi')

  const parts = text.split(regex)

  return (
    <span className={className}>
      {parts.map((part, index) => {
        if (!part) return null

        const isMatch = regex.test(part)

        return (
          <Fragment key={index}>
            {isMatch ? (
              <span className='rounded-sm bg-yellow-200 px-0.5 py-0.5 font-medium text-yellow-900 dark:bg-yellow-900/50 dark:text-yellow-200'>
                {part}
              </span>
            ) : (
              part
            )}
          </Fragment>
        )
      })}
    </span>
  )
}
