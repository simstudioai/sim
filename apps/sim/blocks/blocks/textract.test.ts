/**
 * An Agent tool call runs the block mapper over `{ ...storedRowParams, ...modelArgs }` with the
 * operation only in `context`; the tool then receives `{ ...merged, ...mapped }`.
 */
import { describe, expect, it } from 'vitest'
import { TextractV2Block } from '@/blocks/blocks/textract'

const AWS = { accessKeyId: 'key', secretAccessKey: 'secret', region: 'us-east-1' }

function toolCallParams(args: Record<string, unknown>, operation: string) {
  const mapped = TextractV2Block.tools.config?.params?.(args, { operation }) ?? {}
  return { ...args, ...mapped }
}

describe('Textract on an Agent tool call', () => {
  it('sends the identity document URL stored on an Analyze ID tool row', () => {
    expect(
      toolCallParams({ ...AWS, document: 'https://example.com/id.png' }, 'analyze_id')
    ).toMatchObject({ filePath: 'https://example.com/id.png' })
  })

  it('keeps the feature types the model chose when it also sends queries', () => {
    expect(
      toolCallParams(
        {
          ...AWS,
          document: { name: 'doc.png', key: 'k', url: 'https://example.com/doc.png' },
          featureTypes: ['FORMS'],
          queries: [{ Text: 'What is the total?' }],
        },
        'analyze_document'
      )
    ).toMatchObject({
      featureTypes: ['FORMS', 'QUERIES'],
      queries: [{ Text: 'What is the total?' }],
    })
  })
})
