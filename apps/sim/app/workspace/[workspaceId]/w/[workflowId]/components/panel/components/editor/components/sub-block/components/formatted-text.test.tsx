import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatDisplayText, getValidWorkflowSearchRange } from './formatted-text'

describe('formatDisplayText workflow search highlighting', () => {
  it('marks only the active duplicate occurrence', () => {
    const html = renderToStaticMarkup(
      <>
        {formatDisplayText('alpha beta alpha', {
          workflowSearchHighlight: {
            range: { start: 11, end: 16 },
            rawValue: 'alpha',
          },
        })}
      </>
    )

    expect(html).toContain('<mark')
    expect(html).toContain('<span>alpha beta </span><mark')
    expect((html.match(/<mark/g) ?? []).length).toBe(1)
  })

  it('does not mark stale ranges', () => {
    const html = renderToStaticMarkup(
      <>
        {formatDisplayText('alpha beta', {
          workflowSearchHighlight: {
            range: { start: 0, end: 5 },
            rawValue: 'gamma',
          },
        })}
      </>
    )

    expect(html).not.toContain('<mark')
    expect(
      getValidWorkflowSearchRange('alpha beta', { range: { start: 0, end: 5 }, rawValue: 'gamma' })
    ).toBeNull()
  })

  it('escapes html-like strings while preserving the exact mark', () => {
    const html = renderToStaticMarkup(
      <>
        {formatDisplayText('<script>alert(1)</script>', {
          workflowSearchHighlight: {
            range: { start: 0, end: 8 },
            rawValue: '<script>',
          },
        })}
      </>
    )

    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<mark')
    expect(html).not.toContain('<script>')
  })

  it('keeps reference formatting inside the active mark', () => {
    const html = renderToStaticMarkup(
      <>
        {formatDisplayText('use <Start.output>', {
          workflowSearchHighlight: {
            range: { start: 4, end: 18 },
            rawValue: '<Start.output>',
          },
          highlightAll: true,
        })}
      </>
    )

    expect(html).toContain('<mark')
    expect(html).toContain('text-[var(--brand-secondary)]')
    expect(html).toContain('&lt;Start.output&gt;')
  })
})
