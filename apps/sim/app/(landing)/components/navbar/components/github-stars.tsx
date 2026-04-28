'use client'

import { GithubOutlineIcon } from '@/components/icons'
import { useGitHubStars } from '@/hooks/queries/github-stars'

/**
 * Client component that displays GitHub stars count.
 *
 * Isolated as a client component to allow the parent Navbar to remain
 * a Server Component for optimal SEO/GEO crawlability.
 */
export function GitHubStars() {
  const { data: stars } = useGitHubStars()

  return (
    <a
      href='https://github.com/simstudioai/sim'
      target='_blank'
      rel='noopener noreferrer'
      className='flex h-[30px] items-center gap-2 self-center rounded-[5px] px-3 transition-colors duration-200 group-hover:bg-[var(--landing-bg-elevated)]'
      aria-label={`GitHub repository — ${stars} stars`}
    >
      <GithubOutlineIcon className='h-[14px] w-[14px]' />
      <span aria-live='polite'>{stars}</span>
    </a>
  )
}
