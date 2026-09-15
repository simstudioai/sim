/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/emcn', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
  chipHoverSurfaceClass: '',
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Content: () => null,
  },
}))

vi.mock('@sim/emcn/icons', () => ({ SquareArrowUpRight: () => null }))

import { CitedContent } from '@/app/(landing)/comparisons/components/source-info/cited-content'

const SOURCES = [
  { url: 'https://primary.example/terms', label: 'Product terms', asOf: '2026-09-13' },
]

describe('SourcePopover accessible content', () => {
  it('preserves the complete claim and qualifications in the citation button name', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
      <CitedContent sources={SOURCES} label='Licensing'>
        <span>
          The core is open source. <strong>Enterprise has separate terms.</strong>
        </span>
      </CitedContent>
    )

    expect(container.querySelector('button')).toHaveAccessibleName(
      'The core is open source. Enterprise has separate terms. — Licensing: 1 source'
    )
  })

  it('keeps directory source buttons associated with their product description', () => {
    const container = document.createElement('div')
    container.innerHTML = renderToStaticMarkup(
      <CitedContent sources={SOURCES} label='Example product description'>
        Sources
      </CitedContent>
    )

    expect(container.querySelector('button')).toHaveAccessibleName(
      'Sources — Example product description: 1 source'
    )
  })
})
