/** @vitest-environment node */
import type { SessionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { readOrganizationAssistantImage } from '@/lib/uploads/contexts/organization-assistant/application'
import { ASSISTANT_IMAGE_MAX_COUNT } from '@/lib/uploads/shared/assistant-images'

const { readImage } = vi.hoisted(() => ({
  readImage: vi.fn<typeof readOrganizationAssistantImage>(),
}))
vi.mock('@/lib/uploads/contexts/organization-assistant/application', () => ({
  readOrganizationAssistantImage: readImage,
}))

import { prepareAssistantImages } from '@/lib/copilot/chat/assistant-images'
import { getMothershipAttachmentPreviewUrl } from '@/lib/copilot/chat/attachment-preview'

const principal: SessionPrincipal = { kind: 'session', userId: 'user-1', sessionId: 'session-1' }
const key = 'assistant/org-1/user-1/upload-1/image.png'
const image = {
  id: 'upload-1',
  key,
  name: 'image.png',
  contentType: 'image/png',
  size: 5,
  buffer: Buffer.from('image'),
}

describe('Assistant image preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readImage.mockResolvedValue(image)
  })

  it('uses canonical metadata and model content from the authorized reader', async () => {
    const signal = new AbortController().signal
    const result = await prepareAssistantImages({
      principal,
      organizationId: 'org-1',
      attachments: [{ key }],
      signal,
    })
    expect(readImage).toHaveBeenCalledWith({ principal, organizationId: 'org-1', key, signal })
    expect(result).toEqual({
      attachments: [
        { id: 'upload-1', key, filename: 'image.png', media_type: 'image/png', size: 5 },
      ],
      content: [
        {
          type: 'image',
          filename: 'image.png',
          source: { type: 'base64', media_type: 'image/png', data: 'aW1hZ2U=' },
        },
      ],
    })
    expect(getMothershipAttachmentPreviewUrl(result.attachments[0])).toBe(
      `/api/files/serve/${encodeURIComponent(key)}?context=mothership&preview=1`
    )
  })

  it('rejects an oversized batch before reading any image', async () => {
    await expect(
      prepareAssistantImages({
        principal,
        organizationId: 'org-1',
        attachments: Array.from({ length: ASSISTANT_IMAGE_MAX_COUNT + 1 }, () => ({ key })),
      })
    ).rejects.toMatchObject({ code: 'validation' })
    expect(readImage).not.toHaveBeenCalled()
  })

  it('fails the entire turn if any image is inaccessible', async () => {
    readImage.mockRejectedValueOnce(new OrchestrationError('not_found', 'Image not found'))
    await expect(
      prepareAssistantImages({
        principal,
        organizationId: 'org-1',
        attachments: [{ key }, { key: 'another-image' }],
      })
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(readImage).toHaveBeenCalledOnce()
  })

  it('rejects non-image content even if an upstream reader returns it', async () => {
    readImage.mockResolvedValueOnce({ ...image, contentType: 'application/pdf' })
    await expect(
      prepareAssistantImages({ principal, organizationId: 'org-1', attachments: [{ key }] })
    ).rejects.toMatchObject({ code: 'validation' })
  })

  it('does not read images after the request is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      prepareAssistantImages({
        principal,
        organizationId: 'org-1',
        attachments: [{ key }],
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(readImage).not.toHaveBeenCalled()
  })
})
