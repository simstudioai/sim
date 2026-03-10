'use client'

import { useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { GithubOutlineIcon } from '@/components/icons'
import { getFormattedGitHubStars } from '@/app/(landing)/actions/github'

const logger = createLogger('github-stars')

const INITIAL_STARS = '26.4k'

/**
 * Client component that displays GitHub stars count.
 *
 * Isolated as a client component to allow the parent Navbar to remain
 * a Server Component for optimal SEO/GEO crawlability.
 */
export function GitHubStars() {
  const [stars, setStars] = useState(INITIAL_STARS)

  useEffect(() => {
    getFormattedGitHubStars()
      .then(setStars)
      .catch((error) => {
        logger.warn('Failed to fetch GitHub stars', error)
      })
  }, [])

  return (
    <a
      href='https://github.com/simstudioai/sim'
      target='_blank'
      rel='noopener noreferrer'
      className='flex items-center gap-[8px] px-[12px]'
      aria-label={`GitHub repository — ${stars} stars`}
    >
      <GithubOutlineIcon className='h-[14px] w-[14px]' />
      <span aria-live='polite'>{stars}</span>
    </a>
  )
}
