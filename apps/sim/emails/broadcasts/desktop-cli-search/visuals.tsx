'use client'

import { useRef } from 'react'
import { Chip, ComposerActionButton, cn } from '@sim/emcn'
import { ArrowUp } from '@sim/emcn/icons'
import { GithubIcon, GmailIcon, GoogleDriveIcon, SlackIcon } from '@/components/icons'
import {
  LANDING_STAGE_RADIUS,
  LANDING_STAGE_WINDOW_RADIUS,
  LANDING_WINDOW_SHADOW,
} from '@/app/(landing)/components/landing-layout'
import { CodeWindowGraphic } from '@/app/(landing)/components/shared/code-window-graphic'
import { SearchInputBar } from '@/app/o/[organizationId]/components/search-input-bar'

const SOURCES = [
  { name: 'Slack', icon: SlackIcon },
  { name: 'Google Drive', icon: GoogleDriveIcon },
  { name: 'GitHub', icon: GithubIcon },
  { name: 'Gmail', icon: GmailIcon },
] as const

interface NewsletterVisualProps {
  kind: 'cli' | 'search'
}

/** Render these product components to images; the broadcast itself stays email-safe HTML. */
export function NewsletterVisual({ kind }: NewsletterVisualProps) {
  return (
    <div
      data-newsletter-visual={kind}
      aria-hidden
      inert
      className={cn(
        'relative flex w-[600px] items-center overflow-hidden bg-[var(--surface-3)] p-7',
        LANDING_STAGE_RADIUS,
        kind === 'cli' ? 'h-[366px]' : 'h-[310px]'
      )}
    >
      <img
        src='/landing/hero-artwork/painting-1200-04e474a8546d.webp'
        alt=''
        className='absolute inset-0 size-full object-cover'
      />
      <div className='relative w-full'>
        {kind === 'cli' ? (
          <CodeWindowGraphic
            filename='getting-started.sh'
            commands={['bun add -g sim', 'sim login', 'sim workflows list --output json']}
          />
        ) : (
          <SearchNewsletterVisual query='What’s the latest on the launch?' />
        )}
      </div>
    </div>
  )
}

interface SearchNewsletterVisualProps {
  query: string
}

function SearchNewsletterVisual({ query }: SearchNewsletterVisualProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  return (
    <div
      className={cn(
        'flex flex-col gap-6 bg-[var(--surface-2)] px-6 py-8',
        LANDING_STAGE_WINDOW_RADIUS,
        LANDING_WINDOW_SHADOW
      )}
    >
      <h2 className='text-center text-2xl text-[var(--text-primary)]'>Search your company.</h2>
      <SearchInputBar
        inputRef={inputRef}
        value={query}
        onChange={() => {}}
        onSubmit={() => {}}
        floating
        submitControl={
          <ComposerActionButton aria-label='Search' active>
            <ArrowUp className='size-[16px] text-white' />
          </ComposerActionButton>
        }
      />
      <div className='flex justify-center gap-2'>
        {SOURCES.map(({ name, icon }) => (
          <Chip key={name} variant='outline' leftIcon={icon}>
            {name}
          </Chip>
        ))}
      </div>
    </div>
  )
}
