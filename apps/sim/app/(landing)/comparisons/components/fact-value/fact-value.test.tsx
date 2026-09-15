/**
 * @vitest-environment node
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Fact } from '@/lib/compare/data'

vi.mock('@sim/emcn', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: () => null,
  chipHoverSurfaceClass: '',
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  Tooltip: {
    Root: ({ children }: { children: ReactNode }) => <>{children}</>,
    Trigger: ({ children }: { children: ReactNode }) => <>{children}</>,
    Content: ({ children }: { children: ReactNode }) => (
      <span data-testid='source-tooltip'>{children}</span>
    ),
  },
}))

vi.mock('@sim/emcn/icons', () => ({
  SquareArrowUpRight: () => null,
  Check: () => <svg data-icon='check' />,
  X: () => <svg data-icon='x' />,
}))

import { FactValue } from '@/app/(landing)/comparisons/components/fact-value/fact-value'

const PRIMARY_SOURCE = {
  url: 'https://primary.example/compliance',
  label: 'Primary compliance source',
  asOf: '2026-09-04',
}

function createFact(overrides: Partial<Fact> = {}): Fact {
  return {
    value: 'Complete compliance statement',
    detail: 'Supporting qualification',
    shortValue: 'Compact compliance summary',
    confidence: 'verified',
    sources: [
      PRIMARY_SOURCE,
      {
        url: 'https://secondary.example/compliance',
        label: 'Secondary compliance source',
        asOf: '2026-09-04',
      },
    ],
    ...overrides,
  }
}

function withoutScreenReaderText(markup: string): string {
  const index = markup.lastIndexOf('<span class="sr-only">')
  return index === -1 ? markup : markup.slice(0, index)
}

function screenReaderText(markup: string): string {
  const fullTextMarkup = markup.slice(markup.lastIndexOf('<span class="sr-only">'))
  const match = fullTextMarkup.match(/<span class="sr-only">(.*?)<\/span>/)
  expect(match).not.toBeNull()
  return match?.[1] ?? ''
}

describe('FactValue', () => {
  it('shows shortValue while exposing the complete value and detail once to screen readers', () => {
    const markup = renderToStaticMarkup(<FactValue label='Compliance' fact={createFact()} />)
    const visibleMarkup = withoutScreenReaderText(markup)
    const accessibleText = screenReaderText(markup)

    expect(visibleMarkup).toContain('Compact compliance summary')
    expect(visibleMarkup).not.toContain('Complete compliance statement')
    expect(accessibleText).toContain('Complete compliance statement. Supporting qualification')
    expect(accessibleText.match(/Complete compliance statement/g)).toHaveLength(1)
    expect(accessibleText.match(/Supporting qualification/g)).toHaveLength(1)
  })

  it('keeps plan restrictions visible for verified affirmative facts', () => {
    const markup = renderToStaticMarkup(
      <FactValue
        label='Export'
        fact={createFact({
          value: 'Yes: Enterprise supports scheduled exports',
          shortValue: 'Enterprise scheduled exports',
        })}
      />
    )

    expect(withoutScreenReaderText(markup)).toContain('Enterprise scheduled exports')
    expect(markup).toContain('data-icon="check"')
  })

  it('shows the full qualification when no source control is available', () => {
    const markup = renderToStaticMarkup(
      <FactValue label='Support' fact={createFact({ sources: [], confidence: 'unknown' })} wrap />
    )
    expect(withoutScreenReaderText(markup)).toContain(
      'Complete compliance statement. Supporting qualification'
    )
    expect(markup.match(/Complete compliance statement/g)).toHaveLength(1)
    expect(markup.match(/Supporting qualification/g)).toHaveLength(1)
  })

  it('falls back to value and renders a fact without detail', () => {
    const markup = renderToStaticMarkup(
      <FactValue
        label='Compliance'
        fact={createFact({
          value: 'Fallback visible value',
          shortValue: undefined,
          detail: undefined,
          sources: [],
        })}
      />
    )

    expect(withoutScreenReaderText(markup)).toContain('Fallback visible value')
    expect(markup.match(/Fallback visible value/g)).toHaveLength(1)
  })

  it.each([
    ['Statement.', 'Statement. Detail'],
    ['Statement!', 'Statement! Detail'],
    ['Statement?', 'Statement? Detail'],
    ['Statement.)', 'Statement.) Detail'],
    ['Statement.”', 'Statement.” Detail'],
    ['Statement', 'Statement. Detail'],
  ])('joins %j and detail without duplicate punctuation', (value, expected) => {
    const markup = renderToStaticMarkup(
      <FactValue label='Compliance' fact={createFact({ value, detail: 'Detail', sources: [] })} />
    )

    expect(markup).toContain(expected)
    expect(markup).not.toContain('class="sr-only"')
  })

  it('opens the redesigned source popover and retains every citation in server-rendered text', () => {
    const markup = renderToStaticMarkup(<FactValue label='Compliance' fact={createFact()} />)
    const visibleMarkup = withoutScreenReaderText(markup)

    expect(visibleMarkup).toContain('Compliance: 2 sources')
    expect(visibleMarkup).not.toContain(PRIMARY_SOURCE.url)
    expect(markup).toContain(PRIMARY_SOURCE.url)
    expect(markup).toContain(PRIMARY_SOURCE.label)
    expect(markup).toContain('https://secondary.example/compliance')
    expect(markup).toContain('Secondary compliance source')
    expect(markup).toContain('Checked 2026-09-04')
  })

  it.each(['unknown', 'estimated'] as const)(
    'preserves negation without a definitive icon for %s claims',
    (confidence) => {
      const markup = renderToStaticMarkup(
        <FactValue
          label='Compliance'
          fact={createFact({
            value: 'No: self-hosted deployment',
            shortValue: undefined,
            confidence,
          })}
        />
      )
      expect(markup).not.toContain('data-icon=')
      expect(withoutScreenReaderText(markup)).toContain('No: self-hosted deployment')
      expect(markup).toContain(confidence === 'unknown' ? '(unverified)' : '(estimate)')
    }
  )
})
