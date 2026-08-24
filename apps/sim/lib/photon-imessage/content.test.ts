/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { collectPhotonAttachments, collectPhotonText } from '@/lib/photon-imessage/content'

const attachmentNode = {
  type: 'attachment',
  id: 'att-1',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 2048,
}

const voiceNode = { type: 'voice', id: 'voice-1', mimeType: 'audio/x-caf' }

describe('collectPhotonText', () => {
  it('reads a plain text node', () => {
    expect(collectPhotonText({ type: 'text', text: 'hello there' })).toBe('hello there')
  })

  it('reaches through a reply wrapper to the inner content', () => {
    expect(
      collectPhotonText({
        type: 'reply',
        content: { type: 'text', text: 'replying to you' },
        target: { id: 'msg-1' },
      })
    ).toBe('replying to you')
  })

  it('joins every text in a group rather than stopping at the first', () => {
    expect(
      collectPhotonText({
        type: 'group',
        items: [
          { content: { type: 'text', text: 'first' } },
          { content: attachmentNode },
          { content: { type: 'text', text: 'second' } },
        ],
      })
    ).toBe('first\nsecond')
  })

  it('skips an empty text in a group instead of treating it as the answer', () => {
    expect(
      collectPhotonText({
        type: 'group',
        items: [
          { content: { type: 'text', text: '' } },
          { content: { type: 'text', text: 'the real message' } },
        ],
      })
    ).toBe('the real message')
  })

  it('accepts a group item that is the content node itself', () => {
    expect(collectPhotonText({ type: 'group', items: [{ type: 'text', text: 'unwrapped' }] })).toBe(
      'unwrapped'
    )
  })

  it('returns an empty string for content that carries no text', () => {
    expect(collectPhotonText(attachmentNode)).toBe('')
    expect(collectPhotonText({ type: 'reaction', emoji: '❤️' })).toBe('')
    expect(collectPhotonText(null)).toBe('')
    expect(collectPhotonText('not a node')).toBe('')
  })
})

describe('collectPhotonAttachments', () => {
  it('summarizes an attachment node', () => {
    expect(collectPhotonAttachments(attachmentNode)).toEqual([
      { id: 'att-1', name: 'photo.jpg', mimeType: 'image/jpeg', size: 2048 },
    ])
  })

  it('treats a native voice memo as an attachment, nulling the fields it omits', () => {
    expect(collectPhotonAttachments(voiceNode)).toEqual([
      { id: 'voice-1', name: null, mimeType: 'audio/x-caf', size: null },
    ])
  })

  it('collects every media node in a group, through a reply wrapper', () => {
    expect(
      collectPhotonAttachments({
        type: 'reply',
        content: {
          type: 'group',
          items: [
            { content: { type: 'text', text: 'look' } },
            { content: attachmentNode },
            { content: voiceNode },
          ],
        },
      }).map((attachment) => attachment.id)
    ).toEqual(['att-1', 'voice-1'])
  })

  it('returns nothing for content that carries no media', () => {
    expect(collectPhotonAttachments({ type: 'text', text: 'hi' })).toEqual([])
    expect(collectPhotonAttachments(null)).toEqual([])
  })
})

describe('surface parity', () => {
  /**
   * The webhook handler and the Get Message tool both read a message through these walkers, so a
   * grouped delivery reports identically on either — the drift this module exists to prevent.
   */
  it('reports one grouped message the same way for both readers', () => {
    const grouped = {
      type: 'group',
      items: [
        { content: { type: 'text', text: 'caption one' } },
        { content: attachmentNode },
        { content: { type: 'text', text: 'caption two' } },
        { content: voiceNode },
      ],
    }

    const triggerText = collectPhotonText(grouped)
    const toolText = collectPhotonText(grouped) || null

    expect(triggerText).toBe('caption one\ncaption two')
    expect(toolText).toBe(triggerText)
    expect(collectPhotonAttachments(grouped)).toEqual([
      { id: 'att-1', name: 'photo.jpg', mimeType: 'image/jpeg', size: 2048 },
      { id: 'voice-1', name: null, mimeType: 'audio/x-caf', size: null },
    ])
  })
})
