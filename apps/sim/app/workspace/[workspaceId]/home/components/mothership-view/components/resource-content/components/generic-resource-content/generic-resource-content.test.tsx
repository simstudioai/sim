/**
 * @vitest-environment node
 */
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GenericResourceContent } from './generic-resource-content'

describe('GenericResourceContent', () => {
  it('renders the completed verb for a successful tool result', () => {
    const markup = renderToStaticMarkup(
      <GenericResourceContent
        data={{
          entries: [
            {
              toolCallId: 'diff-1',
              toolName: 'diff_workflows',
              displayTitle: 'Comparing workflows',
              status: 'success',
              result: { success: true, output: { differences: [] } },
            },
          ],
        }}
      />
    )

    expect(markup).toContain('Compared workflows')
    expect(markup).not.toContain('Comparing workflows')
  })
})
