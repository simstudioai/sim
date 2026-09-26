import { storageServiceMock } from '@sim/testing/mocks/storage-service.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { planForkInlineImages } from '@/lib/mothership/chat/fork-inline-images'
import { inlineChatImageKey } from '@/lib/mothership/chat/inline-image-storage'
import type { PersistedMessage } from '@/lib/mothership/chat/persisted-message'

const message = (content: string): PersistedMessage => ({
  id: 'message',
  requestId: 'request',
  role: 'assistant',
  content,
  timestamp: '2026-09-15',
})
describe('Markdown chat image fork', () => {
  it('copies only retained assistant references with unchanged transcript and stable request identity', () => {
    const content = '![Chart](files/chart.png)\n\n![Again](files/chart.png)'
    const messages = [{ ...message(content), contentBlocks: [{ type: 'text' as const, content }] }]
    const before = structuredClone(messages)
    const tasks = planForkInlineImages(messages, 'source', 'fork')
    expect(tasks).toHaveLength(1)
    expect(messages).toEqual(before)
    expect(tasks[0]).toMatchObject({
      sourceKey: inlineChatImageKey('source', 'request', 'files/chart.png'),
      targetKey: inlineChatImageKey('fork', 'request', 'files/chart.png'),
      persistMetadata: false,
      maxBytes: 5 * 1024 * 1024,
    })
  })
  it('ignores code, ordinary links, user text, remote URLs and history without a request receipt', () => {
    const content =
      '`![code](/tmp/x.png)`\n\n```markdown\n![example](/tmp/x.png)\n```\n\n[link](/tmp/x.png)\n\n![remote](https://example.com/image.png)'
    expect(
      planForkInlineImages(
        [
          message(content),
          { ...message('![user](/tmp/x.png)'), role: 'user' },
          { ...message('![legacy](/tmp/x.png)'), requestId: undefined },
        ],
        'source',
        'fork'
      )
    ).toEqual([])
  })
  it('resolves reference-style Markdown and deduplicates equivalent URI spellings', () => {
    const content =
      '![Chart][asset]\n\n![Same](files/my%20image.png)\n\n[asset]: <files/my image.png>'
    expect(planForkInlineImages([message(content)], 'source', 'fork')).toHaveLength(1)
  })
})
