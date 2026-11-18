import { describe, expect, it } from 'vitest'
import post from '@/tools/buffer/__fixtures__/post.json'
import { bufferSelection, projectBufferObject } from '@/tools/buffer/schema'

/** The field names a GraphQL selection set picks at its own level, without nested selections. */
function topLevelFields(selection: string): string[] {
  let depth = 0
  let flat = ''
  for (const char of selection) {
    if (char === '{') depth++
    else if (char === '}') depth--
    else if (depth === 0) flat += char
  }
  return flat.split(/\s+/).filter(Boolean)
}

describe('Buffer response schema', () => {
  it('keeps a channel whose allowedActions include a value added by Buffer after this schema', () => {
    const channel = projectBufferObject('Channel', {
      ...post.channel,
      allowedActions: ['shuffleQueue', 'emptyQueue', 'someFutureAction'],
    })

    expect(channel.allowedActions).toEqual(['shuffleQueue', 'emptyQueue', 'someFutureAction'])
  })

  it('never selects ThreadedPost.linkAttachment, which Buffer removes on 2026-12-15', () => {
    const fields = topLevelFields(bufferSelection('ThreadedPost'))

    expect(fields).toEqual(expect.arrayContaining(['assets', 'metadata', 'text']))
    expect(fields).not.toContain('linkAttachment')
  })
})
