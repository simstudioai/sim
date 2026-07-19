'use client'

import {
  Chip,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  useCopyToClipboard,
} from '@sim/emcn'
import { Duplicate } from '@sim/emcn/icons'
import { LinkedInIcon, xIcon as XIcon } from '@/components/icons'
import { buildLinkedInPostUrl, buildXShareUrl } from '@/lib/social-share'

interface ShareLinkButtonProps {
  /** The resource name, shown in the composed post. */
  title: string
  /** The resource kind ("Interface" / "File" / "Chat"), used in the post's lead line. */
  kind: string
}

/**
 * The "Share" CTA for a public resource header (shared file / interface / chat) —
 * a primary chip with the same chrome as the landing sign-up CTA that opens a
 * menu to copy the page link or post it to X / LinkedIn with a pre-drafted
 * message ("Check out my {brand} {kind}! / {name} / {link}").
 *
 * The brand mention differs by platform: X gets `@simdotai`, which the tweet
 * intent renders as a real tag; LinkedIn cannot create `@`-mentions from a share
 * URL (its composer treats `text` as literal — a real mention only exists as an
 * org URN created live in the composer or via the API), so it uses plain "Sim" to
 * avoid a dead "@simdotai". LinkedIn also uses the feed composer, not
 * `share-offsite`, which can't pre-fill text. The X and LinkedIn glyphs are
 * `currentColor`, so they follow the menu item's text color; these surfaces are
 * pinned light by the theme provider (`forcedTheme`), so the portalled menu
 * resolves light tokens to match.
 */
export function ShareLinkButton({ title, kind }: ShareLinkButtonProps) {
  const { copied, copy } = useCopyToClipboard({ resetMs: 1500 })

  const composePost = (brand: string) =>
    `Check out my ${brand} ${kind}!\n\n${title}: ${window.location.href}`

  const openShare = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Chip variant='primary' aria-label='Share'>
          Share
        </Chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onSelect={() => copy(window.location.href)}>
          <Duplicate className='size-4' />
          {copied ? 'Copied!' : 'Copy link'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openShare(buildXShareUrl(composePost('@simdotai')))}>
          <XIcon className='size-4' />
          Post on X
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openShare(buildLinkedInPostUrl(composePost('Sim')))}>
          <LinkedInIcon className='size-4' />
          Post on LinkedIn
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
