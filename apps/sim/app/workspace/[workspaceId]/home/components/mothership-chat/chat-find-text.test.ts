import { describe, expect, it } from 'vitest'
import { getChatFindText } from '@/app/workspace/[workspaceId]/home/components/mothership-chat/chat-find-text'

describe('chat find text', () => {
  it('searches visible Markdown across inline formatting without indexing link destinations', () => {
    expect(getChatFindText('A **formatted** [answer](https://example.com/hidden).')).toBe(
      'A formatted answer.'
    )
  })

  it('keeps separate blocks and inline images from creating joined words', () => {
    expect(getChatFindText('first\n\nsecond\n\nleft![image](image.png)right')).toBe(
      'first\nsecond\nleft\uffffright'
    )
  })

  it('preserves code and decodes escaped prose without indexing reference definitions', () => {
    expect(
      getChatFindText('Use `a_b` and a\\_b &amp; c.\n\n```ts\na_b()\n```\n\n[ref]: /hidden')
    ).toBe('Use a_b and a_b & c.\na_b()')
  })
})
