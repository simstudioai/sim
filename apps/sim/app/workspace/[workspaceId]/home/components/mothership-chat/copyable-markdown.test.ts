import { describe, expect, it } from 'vitest'
import { toCopyableMarkdown } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/copyable-markdown'

describe('toCopyableMarkdown', () => {
  it('preserves message Markdown, including fenced code and its language', () => {
    const message = [
      '# Elevator diagnosis',
      '',
      'The bug is in `dispatch_legacy.py`:',
      '',
      '```python',
      'def next_stop(requests, current):',
      '    ranked = sorted(requests)',
      '    return ranked[1:]',
      '```',
      '',
      '**Result:** the closest request *was not* always selected.',
    ].join('\n')

    expect(toCopyableMarkdown(message)).toBe(message)
  })

  it('removes internal structured tags without flattening surrounding Markdown', () => {
    const message = [
      'Before **formatted text**.',
      '<credential>{"type":"service_account","provider":"gmail"}</credential>',
      'After [a link](https://example.com).',
    ].join('\n')

    expect(toCopyableMarkdown(message)).toBe(
      ['Before **formatted text**.', '', 'After [a link](https://example.com).'].join('\n')
    )
  })

  it('preserves tag-shaped text that the chat renders literally', () => {
    const message = [
      'Document `<credential>example</credential>`.',
      '',
      '```html',
      '<file>example</file>',
      '<question>example</question>',
      '```',
    ].join('\n')

    expect(toCopyableMarkdown(message)).toBe(message)
  })
})
