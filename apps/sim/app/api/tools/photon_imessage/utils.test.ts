/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The real SDK opens gRPC connections on construction, so both Spectrum packages are mocked. The
 * mocks are deliberately thin: these tests cover the pooling, attachment, and error-mapping logic
 * this module owns, not the provider's behavior.
 */
const {
  MockUnsupportedError,
  contentBuilder,
  mockGetAttachment,
  mockGetMessage,
  mockSpaceCreate,
  mockSpaceGet,
  mockSpectrum,
  mockStop,
} = vi.hoisted(() => ({
  MockUnsupportedError: class MockUnsupportedError extends Error {},
  contentBuilder: (type: string) => vi.fn((...args: unknown[]) => ({ type, args })),
  mockGetAttachment: vi.fn(),
  mockGetMessage: vi.fn(),
  mockSpaceCreate: vi.fn(),
  mockSpaceGet: vi.fn(),
  mockSpectrum: vi.fn(),
  mockStop: vi.fn(),
}))

vi.mock('@spectrum-ts/core', () => ({
  Spectrum: mockSpectrum,
  UnsupportedError: MockUnsupportedError,
  addMember: contentBuilder('addMember'),
  attachment: contentBuilder('attachment'),
  avatar: contentBuilder('avatar'),
  edit: contentBuilder('edit'),
  leaveSpace: contentBuilder('leaveSpace'),
  poll: contentBuilder('poll'),
  reaction: contentBuilder('reaction'),
  read: contentBuilder('read'),
  removeMember: contentBuilder('removeMember'),
  rename: contentBuilder('rename'),
  reply: contentBuilder('reply'),
  text: contentBuilder('text'),
  typing: contentBuilder('typing'),
  unsend: contentBuilder('unsend'),
  voice: contentBuilder('voice'),
}))

vi.mock('@spectrum-ts/imessage', () => ({
  effect: contentBuilder('effect'),
  imessage: Object.assign(
    vi.fn(() => ({
      space: { get: mockSpaceGet, create: mockSpaceCreate },
      user: vi.fn(async (handle: string) => ({ id: handle })),
      getAttachment: mockGetAttachment,
      shareContactCard: vi.fn(),
      background: vi.fn(),
    })),
    {
      config: vi.fn(() => ({ platform: 'imessage' })),
      effect: { message: { balloons: 'com.apple.messages.effect.CKBalloonEffect' } },
    }
  ),
}))

import {
  createPhotonGroup,
  downloadPhotonAttachment,
  getPhotonMessage,
} from '@/app/api/tools/photon_imessage/utils'

const CREDS = { projectId: 'proj-1', projectSecret: 'secret-1' }

/** A chat GUID addresses an existing space directly, so no DM is created along the way. */
const CHAT_ID = 'any;-;+14155551234'

/** Mirrors the pool ceiling in the module under test. */
const MAX_CACHED_INSTANCES = 8

/** Point `space.get` at a space whose single message carries {@link content}. */
function stubMessage(content: unknown) {
  mockSpectrum.mockResolvedValue({ stop: mockStop })
  mockGetMessage.mockResolvedValue({
    id: 'msg-1',
    content,
    sender: { id: '+14155551234' },
    timestamp: new Date('2026-08-21T10:00:00.000Z'),
  })
  mockSpaceGet.mockResolvedValue({ id: CHAT_ID, getMessage: mockGetMessage, send: vi.fn() })
}

describe('photon iMessage tool client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStop.mockResolvedValue(undefined)
  })

  describe('instance pooling', () => {
    it('reuses one instance across calls for the same project', async () => {
      stubMessage({ type: 'text', text: 'hi' })

      await getPhotonMessage({ ...CREDS, chatId: CHAT_ID, messageId: 'msg-1' })
      await getPhotonMessage({ ...CREDS, chatId: CHAT_ID, messageId: 'msg-1' })

      expect(mockSpectrum).toHaveBeenCalledTimes(1)
    })

    it('never stops an instance while an operation is still using it', async () => {
      // Push the held project past the pool ceiling while its own download is still in flight, so
      // `stop()` on that instance must wait for the download to finish.
      let releaseDownload: (() => void) | undefined
      mockGetAttachment.mockImplementationOnce(async () => {
        await new Promise<void>((resolve) => {
          releaseDownload = resolve
        })
        return {
          name: 'a.jpg',
          mimeType: 'image/jpeg',
          size: 1,
          read: async () => Buffer.from('x'),
        }
      })
      stubMessage({ type: 'text', text: 'hi' })

      // A dedicated spy for the held instance: evicting the other pooled projects legitimately
      // stops those, and only this one must survive until its download completes.
      const heldStop = vi.fn().mockResolvedValue(undefined)
      mockSpectrum.mockResolvedValueOnce({ stop: heldStop })

      const held = downloadPhotonAttachment({
        projectId: 'held-project',
        projectSecret: 's',
        attachmentId: 'att-1',
      })
      // Let the held download reach its await before filling the pool behind it.
      await vi.waitFor(() => expect(releaseDownload).toBeDefined())

      for (let index = 0; index < MAX_CACHED_INSTANCES; index += 1) {
        await getPhotonMessage({
          projectId: `project-${index}`,
          projectSecret: 's',
          chatId: CHAT_ID,
          messageId: 'msg-1',
        })
      }

      expect(heldStop).not.toHaveBeenCalled()

      releaseDownload?.()
      await expect(held).resolves.toMatchObject({ attachmentId: 'att-1' })

      await vi.waitFor(() => expect(heldStop).toHaveBeenCalledTimes(1))
    })

    it('does not cache a failed construction', async () => {
      mockSpectrum.mockRejectedValueOnce(new Error('bad credentials'))

      await expect(
        getPhotonMessage({
          projectId: 'transient',
          projectSecret: 's',
          chatId: CHAT_ID,
          messageId: 'msg-1',
        })
      ).rejects.toThrow('bad credentials')

      stubMessage({ type: 'text', text: 'hi' })
      await expect(
        getPhotonMessage({
          projectId: 'transient',
          projectSecret: 's',
          chatId: CHAT_ID,
          messageId: 'msg-1',
        })
      ).resolves.toMatchObject({ messageId: 'msg-1' })
    })
  })

  describe('getPhotonMessage attachments', () => {
    it('surfaces a native voice memo so Download Attachment can be driven from it', async () => {
      stubMessage({
        type: 'voice',
        id: 'voice-1',
        name: 'Audio Message.caf',
        mimeType: 'audio/x-caf',
        size: 2048,
      })

      const result = await getPhotonMessage({ ...CREDS, chatId: CHAT_ID, messageId: 'msg-1' })

      expect(result.attachments).toEqual([
        { id: 'voice-1', name: 'Audio Message.caf', mimeType: 'audio/x-caf', size: 2048 },
      ])
    })

    it('walks reply and group wrappers the way the webhook handler does', async () => {
      stubMessage({
        type: 'reply',
        content: {
          type: 'group',
          items: [
            { content: { type: 'text', text: 'look' } },
            {
              content: {
                type: 'attachment',
                id: 'att-1',
                name: 'a.jpg',
                mimeType: 'image/jpeg',
                size: 10,
              },
            },
            { content: { type: 'voice', id: 'voice-1', mimeType: 'audio/x-caf' } },
          ],
        },
      })

      const result = await getPhotonMessage({ ...CREDS, chatId: CHAT_ID, messageId: 'msg-1' })

      expect(result.attachments.map((attachment) => attachment.id)).toEqual(['att-1', 'voice-1'])
      expect(result.attachments[1]).toEqual({
        id: 'voice-1',
        name: null,
        mimeType: 'audio/x-caf',
        size: null,
      })
    })
  })

  describe('downloadPhotonAttachment', () => {
    it('rejects an oversized attachment on its declared size, before reading any bytes', async () => {
      const read = vi.fn()
      mockGetAttachment.mockResolvedValue({
        name: 'huge.mov',
        mimeType: 'video/quicktime',
        size: 60 * 1024 * 1024,
        read,
      })
      stubMessage({ type: 'text', text: 'hi' })

      await expect(
        downloadPhotonAttachment({ ...CREDS, attachmentId: 'att-huge' })
      ).rejects.toThrow(/above the 50MB download limit/)
      expect(read).not.toHaveBeenCalled()
    })

    it('re-checks the delivered bytes when the provider declares no size', async () => {
      mockGetAttachment.mockResolvedValue({
        name: 'huge.mov',
        mimeType: 'video/quicktime',
        size: undefined,
        read: async () => Buffer.alloc(51 * 1024 * 1024),
      })
      stubMessage({ type: 'text', text: 'hi' })

      await expect(
        downloadPhotonAttachment({ ...CREDS, attachmentId: 'att-unknown' })
      ).rejects.toThrow(/above the 50MB download limit/)
    })
  })

  describe('createPhotonGroup', () => {
    it('explains the dedicated-line requirement when the provider says unsupported', async () => {
      stubMessage({ type: 'text', text: 'hi' })
      mockSpaceCreate.mockRejectedValue(new MockUnsupportedError('group create is remote-only'))

      await expect(
        createPhotonGroup({ ...CREDS, handles: ['+15551112222', '+15553334444'] })
      ).rejects.toThrow(/requires a dedicated Photon line/)
    })

    it('leaves every other failure with its own cause', async () => {
      stubMessage({ type: 'text', text: 'hi' })
      mockSpaceCreate.mockRejectedValue(new Error('Unauthorized: invalid project secret'))

      await expect(
        createPhotonGroup({ ...CREDS, handles: ['+15551112222', '+15553334444'] })
      ).rejects.toThrow('Unauthorized: invalid project secret')
    })
  })
})
