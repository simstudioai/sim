'use client'

import { ChipLink } from '@sim/emcn'
import { BookOpen, Rss } from '@sim/emcn/icons'
import { GithubOutlineIcon } from '@/components/icons'

/**
 * Changelog hero actions - the GitHub / Documentation / RSS pill links shown
 * beneath the changelog headline. A small client leaf because `ChipLink` is a
 * Client Component and its `leftIcon` is a component reference that cannot cross
 * the server→client boundary as a prop (same pattern as the platform pill CTA).
 * GitHub is the primary filled chip; Docs and RSS are the default pills.
 */
export function ChangelogActions() {
  return (
    <div className='flex flex-wrap items-center gap-1'>
      <ChipLink
        variant='primary'
        shape='round'
        href='https://github.com/simstudioai/sim/releases'
        target='_blank'
        rel='noopener noreferrer'
        leftIcon={GithubOutlineIcon}
      >
        View on GitHub
      </ChipLink>
      <ChipLink
        shape='round'
        href='https://docs.sim.ai'
        target='_blank'
        rel='noopener noreferrer'
        leftIcon={BookOpen}
      >
        Documentation
      </ChipLink>
      <ChipLink shape='round' href='/changelog.xml' leftIcon={Rss}>
        RSS Feed
      </ChipLink>
    </div>
  )
}
