/**
 * @vitest-environment node
 */
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { Fact } from '@/lib/compare/data'

vi.mock('@sim/emcn', () => ({
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
  return markup.replace(/<span class="sr-only">.*?<\/span>/, '')
}

function screenReaderText(markup: string): string {
  const match = markup.match(/<span class="sr-only">(.*?)<\/span>/)
  expect(match).not.toBeNull()
  return match?.[1] ?? ''
}

describe('FactValue', () => {
  it('shows shortValue while exposing the complete value and detail once to screen readers', () => {
    const markup = renderToStaticMarkup(<FactValue fact={createFact()} />)
    const visibleMarkup = withoutScreenReaderText(markup)
    const accessibleText = screenReaderText(markup)

    expect(visibleMarkup).toContain('Compact compliance summary')
    expect(visibleMarkup).not.toContain('Complete compliance statement')
    expect(accessibleText).toBe('Complete compliance statement. Supporting qualification')
    expect(accessibleText.match(/Complete compliance statement/g)).toHaveLength(1)
    expect(accessibleText.match(/Supporting qualification/g)).toHaveLength(1)
  })

  it('falls back to value and renders a fact without detail', () => {
    const markup = renderToStaticMarkup(
      <FactValue
        fact={createFact({
          value: 'Fallback visible value',
          shortValue: undefined,
          detail: undefined,
          sources: [],
        })}
      />
    )

    expect(withoutScreenReaderText(markup)).toContain('Fallback visible value')
    expect(screenReaderText(markup)).toBe('Fallback visible value')
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
      <FactValue fact={createFact({ value, detail: 'Detail', sources: [] })} />
    )

    expect(screenReaderText(markup)).toBe(expected)
  })

  it('uses the URL and label from sources[0] for the visible source link', () => {
    const markup = renderToStaticMarkup(<FactValue fact={createFact()} />)
    const visibleMarkup = withoutScreenReaderText(markup)

    expect(visibleMarkup).toContain(`href="${PRIMARY_SOURCE.url}"`)
    expect(visibleMarkup).toContain(`aria-label="${PRIMARY_SOURCE.label} (opens source)"`)
    expect(visibleMarkup).not.toContain('https://secondary.example/compliance')
    expect(visibleMarkup).not.toContain('Secondary compliance source')
    expect(visibleMarkup).toContain('Checked 2026-09-04')
  })

  it.each(['unknown', 'estimated'] as const)(
    'preserves negation without a definitive icon for %s claims',
    (confidence) => {
      const markup = renderToStaticMarkup(
        <FactValue
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
