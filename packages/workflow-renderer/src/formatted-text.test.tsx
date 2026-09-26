import { formatDisplayText } from '@sim/workflow-renderer/formatted-text'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

describe('formatDisplayText', () => {
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

  it('scans unterminated brace runs in linear time', () => {
    const started = performance.now()
    formatDisplayText('{'.repeat(100_000))
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
