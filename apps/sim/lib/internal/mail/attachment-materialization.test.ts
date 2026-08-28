/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  download: vi.fn(),
  process: vi.fn(),
}))

vi.mock('@/app/api/files/authorization', () => ({ assertToolFileAccess: mocks.access }))
vi.mock('@/lib/uploads/utils/file-utils', () => ({ processFilesToUserFiles: mocks.process }))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFilesWithinBudget: mocks.download,
}))

import {
  type MailAttachmentMaterializationError,
  materializeAuthorizedMailAttachments,
} from '@/lib/internal/mail/attachment-materialization'

const file = { key: 'workspace/ws-1/a.txt', name: 'a.txt', size: 3, type: 'text/plain' }
const context = { requestId: 'request-1', userId: 'user-1', signal: new AbortController().signal }

describe('mail attachment materialization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.process.mockReturnValue([file])
    mocks.access.mockResolvedValue(null)
    mocks.download.mockResolvedValue([{ buffer: Buffer.from('abc'), contentType: 'text/plain' }])
  })

  it('authorizes files and forwards the cumulative budget and signal', async () => {
    await expect(
      materializeAuthorizedMailAttachments([file], context, {
        label: 'Total attachment size',
        maxTotalBytes: 25,
      })
    ).resolves.toEqual([{ buffer: Buffer.from('abc'), contentType: 'text/plain', name: 'a.txt' }])
    expect(mocks.access).toHaveBeenCalledWith(file.key, 'user-1', 'request-1', expect.anything())
    expect(mocks.download).toHaveBeenCalledWith([file], 'request-1', expect.anything(), {
      totalMaxBytes: 25,
      label: 'Total attachment size',
      signal: context.signal,
    })
  })

  it('rejects declared-size overruns before authorization when requested', async () => {
    await expect(
      materializeAuthorizedMailAttachments([file], context, {
        label: 'Total attachment size',
        maxTotalBytes: 2,
        preflightDeclaredSize: true,
      })
    ).rejects.toMatchObject({ kind: 'size', observedBytes: 3 })
    expect(mocks.access).not.toHaveBeenCalled()
  })

  it('preserves file authorization response bodies', async () => {
    mocks.access.mockResolvedValue(
      Response.json({ success: false, error: 'Forbidden file' }, { status: 403 })
    )
    await expect(
      materializeAuthorizedMailAttachments([file], context, {
        label: 'Total attachment size',
        maxTotalBytes: 25,
      })
    ).rejects.toEqual(
      expect.objectContaining<Partial<MailAttachmentMaterializationError>>({
        kind: 'access',
        status: 403,
        body: { success: false, error: 'Forbidden file' },
      })
    )
  })
})
