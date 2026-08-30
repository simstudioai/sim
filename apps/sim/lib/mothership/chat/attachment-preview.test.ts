/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { getMothershipAttachmentPreviewUrl } from './attachment-preview'

describe('getMothershipAttachmentPreviewUrl', () => {
  it('asks for a preview derivative on images', () => {
    const url = getMothershipAttachmentPreviewUrl({
      key: 'copilot/a.heic',
      media_type: 'image/heic',
    })
    expect(url).toContain('preview=1')
  })

  it('omits preview on videos, which have no derivative path', () => {
    const url = getMothershipAttachmentPreviewUrl({ key: 'copilot/a.mp4', media_type: 'video/mp4' })
    expect(url).not.toContain('preview')
    expect(url).toContain('context=mothership')
  })

  it('returns undefined for a non-renderable attachment', () => {
    expect(
      getMothershipAttachmentPreviewUrl({ key: 'copilot/a.pdf', media_type: 'application/pdf' })
    ).toBeUndefined()
  })

  it('encodes the key so a slashed storage key stays one path segment', () => {
    const url = getMothershipAttachmentPreviewUrl({
      key: 'copilot/nested/a b.png',
      media_type: 'image/png',
    })
    expect(url).toContain(encodeURIComponent('copilot/nested/a b.png'))
  })
})
