/**
 * @vitest-environment node
 */
import type { ComponentType, ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  ChipLink: ({
    children,
    href,
    leftAdornment,
    rightIcon: RightIcon,
    variant,
  }: {
    children: ReactNode
    href: string
    leftAdornment?: ReactNode
    rightIcon?: ComponentType
    variant?: string
  }) => (
    <a href={href} data-variant={variant}>
      {leftAdornment}
      {children}
      {RightIcon ? <RightIcon /> : null}
    </a>
  ),
  ChipTag: ({ children, variant }: { children: ReactNode; variant?: string }) => (
    <span data-tag-variant={variant}>{children}</span>
  ),
}))

vi.mock('@/app/(landing)/components/chevron-arrow', () => ({
  ChevronArrow: () => <svg data-chevron-arrow aria-hidden='true' />,
}))

import { HeroAnnouncementChip } from '@/app/(landing)/components/hero/components/hero-announcement-chip/hero-announcement-chip'

describe('HeroAnnouncementChip', () => {
  it('announces GPT-6 Astra and links to Start building', () => {
    const markup = renderToStaticMarkup(<HeroAnnouncementChip />)

    expect(markup).toContain('data-variant="outline"')
    expect(markup).toContain('data-tag-variant="gray"')
    expect(markup).toContain('href="/signup"')
    expect(markup).toContain('New')
    expect(markup).toContain('Use GPT-6 Astra')
    expect(markup).toContain('Now available')
    expect(markup).toContain('data-chevron-arrow')
  })
})
