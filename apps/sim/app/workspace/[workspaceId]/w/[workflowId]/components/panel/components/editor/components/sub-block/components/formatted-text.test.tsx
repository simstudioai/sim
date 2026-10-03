import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatDisplayText, getValidWorkflowSearchRange } from './formatted-text'

describe('formatDisplayText workflow search highlighting', () => {
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
})
