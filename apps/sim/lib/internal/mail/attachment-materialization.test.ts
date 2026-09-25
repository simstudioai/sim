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

import { materializeAuthorizedMailAttachments } from '@/lib/internal/mail/attachment-materialization'

const file = { key: 'workspace/ws-1/a.txt', name: 'a.txt', size: 3, type: 'text/plain' }
const context = { requestId: 'request-1', userId: 'user-1', signal: new AbortController().signal }

describe('mail attachment materialization', () => {
  beforeEach(() => {
    mocks.process.mockReturnValue([file])
    mocks.access.mockResolvedValue(null)
    mocks.download.mockResolvedValue([{ buffer: Buffer.from('abc'), contentType: 'text/plain' }])
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
})
