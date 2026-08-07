/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchWorkspaceFileBufferMock, getWorkspaceFileMock, isOpaqueEgressSafeMock } = vi.hoisted(
  () => ({
    fetchWorkspaceFileBufferMock: vi.fn(),
    getWorkspaceFileMock: vi.fn(),
    isOpaqueEgressSafeMock: vi.fn(),
  })
)

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-manager', () => ({
  fetchWorkspaceFileBuffer: fetchWorkspaceFileBufferMock,
  getWorkspaceFile: getWorkspaceFileMock,
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isOpaqueWorkspaceFileEgressSafe: isOpaqueEgressSafeMock,
}))

import {
  MAX_ISOLATED_VM_BROKER_RESULT_JSON_CHARS,
  MAX_SANDBOX_IMAGE_DATA_URI_CHARS,
} from '@/lib/execution/isolated-vm-limits'
import { workspaceFileBroker } from '@/lib/execution/sandbox/brokers/workspace-file'

const CONTEXT = { workspaceId: 'workspace-1', requestId: 'request-1' }

function workspaceFileRecord(version: number) {
  const timestamp = new Date(`2026-08-05T00:00:0${version}.000Z`)
  return {
    id: 'file-1',
    workspaceId: CONTEXT.workspaceId,
    name: 'reference.png',
    key: `workspace/${CONTEXT.workspaceId}/reference-v${version}.png`,
    path: `/api/files/serve/reference-v${version}.png`,
    size: version,
    type: 'image/png',
    uploadedBy: 'user-1',
    uploadedAt: timestamp,
    updatedAt: timestamp,
    contentUpdatedAt: timestamp,
    storageContext: 'workspace' as const,
  }
}

describe('workspaceFileBroker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isOpaqueEgressSafeMock.mockResolvedValue(true)
  })

  it('resolves and verifies the current file version on every broker call', async () => {
    const first = workspaceFileRecord(1)
    const second = workspaceFileRecord(2)
    getWorkspaceFileMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    fetchWorkspaceFileBufferMock
      .mockResolvedValueOnce(Buffer.from('first'))
      .mockResolvedValueOnce(Buffer.from('second'))

    await expect(workspaceFileBroker.handle(CONTEXT, { fileId: 'file-1' })).resolves.toEqual({
      dataUri: `data:image/png;base64,${Buffer.from('first').toString('base64')}`,
    })
    await expect(workspaceFileBroker.handle(CONTEXT, { fileId: 'file-1' })).resolves.toEqual({
      dataUri: `data:image/png;base64,${Buffer.from('second').toString('base64')}`,
    })

    expect(isOpaqueEgressSafeMock).toHaveBeenNthCalledWith(1, CONTEXT.workspaceId, {
      fileId: first.id,
      key: first.key,
      context: 'workspace',
    })
    expect(isOpaqueEgressSafeMock).toHaveBeenNthCalledWith(2, CONTEXT.workspaceId, {
      fileId: second.id,
      key: second.key,
      context: 'workspace',
    })
    const dataUriPrefix = 'data:image/png;base64,'
    const envelopeChars = JSON.stringify({ dataUri: dataUriPrefix }).length
    const availableBase64Chars = Math.min(
      MAX_SANDBOX_IMAGE_DATA_URI_CHARS - dataUriPrefix.length,
      MAX_ISOLATED_VM_BROKER_RESULT_JSON_CHARS - envelopeChars
    )
    const maxBytes = Math.floor(availableBase64Chars / 4) * 3
    expect(dataUriPrefix.length + 4 * Math.ceil(maxBytes / 3)).toBeLessThanOrEqual(
      MAX_SANDBOX_IMAGE_DATA_URI_CHARS
    )
    expect(dataUriPrefix.length + 4 * Math.ceil((maxBytes + 1) / 3)).toBeGreaterThan(
      MAX_SANDBOX_IMAGE_DATA_URI_CHARS
    )
    expect(envelopeChars + 4 * Math.ceil(maxBytes / 3)).toBeLessThanOrEqual(
      MAX_ISOLATED_VM_BROKER_RESULT_JSON_CHARS
    )
    expect(fetchWorkspaceFileBufferMock).toHaveBeenNthCalledWith(1, first, { maxBytes })
    expect(fetchWorkspaceFileBufferMock).toHaveBeenNthCalledWith(2, second, { maxBytes })
  })

  it('rejects an unsafe current version before reading its bytes', async () => {
    const record = workspaceFileRecord(1)
    getWorkspaceFileMock.mockResolvedValue(record)
    isOpaqueEgressSafeMock.mockResolvedValue(false)

    await expect(workspaceFileBroker.handle(CONTEXT, { fileId: record.id })).rejects.toThrow(
      'secret provenance is unavailable'
    )
    expect(fetchWorkspaceFileBufferMock).not.toHaveBeenCalled()
  })
})
