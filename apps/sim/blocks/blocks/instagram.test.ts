/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { InstagramBlock } from '@/blocks/blocks/instagram'

describe('InstagramBlock', () => {
  const buildParams = InstagramBlock.tools.config.params!
  const selectTool = InstagramBlock.tools.config.tool!

  it('stays hidden from discovery until the Instagram integration is approved', () => {
    expect(InstagramBlock.hideFromToolbar).toBe(true)
  })

  it('clears stale operation parameters from the runtime input merge', () => {
    const inputs = {
      operation: 'instagram_get_conversation_messages',
      oauthCredential: 'credential-1',
      conversationId: 'conversation-1',
      limit: '12',
      after: 'message-cursor',
      mediaId: 'stale-media-id',
      filename: 'stale-filename.jpg',
      caption: 'stale caption',
    }
    const finalInputs = { ...inputs, ...buildParams(inputs) }

    expect(finalInputs).toMatchObject({
      credential: 'credential-1',
      conversationId: 'conversation-1',
      limit: 12,
      after: 'message-cursor',
    })
    expect(finalInputs.mediaId).toBeUndefined()
    expect(finalInputs.filename).toBeUndefined()
    expect(finalInputs.caption).toBeUndefined()
  })

  it('rejects operations outside the registered Instagram tool set', () => {
    expect(() => selectTool({ operation: 'instagram_unknown_operation' })).toThrow(
      'Unsupported Instagram operation'
    )
  })
})
