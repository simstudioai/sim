/**
 * @vitest-environment node
 *
 * Mount resolution for platform file objects. The authorization assertions run
 * against the real `assertUserFileContentAccess` rather than a stub: which files
 * a Function block may mount is the security-relevant part of this module, and
 * mocking it away would leave exactly that untested.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserFile } from '@/executor/types'

const {
  mockHasCloudStorage,
  mockGeneratePresignedDownloadUrl,
  mockDownloadServableFileFromStorage,
  mockReadWorkspaceFileRecordByKey,
} = vi.hoisted(() => ({
  mockHasCloudStorage: vi.fn(),
  mockGeneratePresignedDownloadUrl: vi.fn(),
  mockDownloadServableFileFromStorage: vi.fn(),
  mockReadWorkspaceFileRecordByKey: vi.fn(),
}))

vi.mock('@/lib/uploads/core/storage-service', () => ({
  hasCloudStorage: mockHasCloudStorage,
  generatePresignedDownloadUrl: mockGeneratePresignedDownloadUrl,
}))

vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadServableFileFromStorage: mockDownloadServableFileFromStorage,
}))

vi.mock('@/lib/workspace-files/application/read-workspace-file-content-by-key', () => ({
  readWorkspaceFileRecordByKey: { execute: mockReadWorkspaceFileRecordByKey },
}))

import {
  MOUNT_URL_TTL_SECONDS,
  planUserFileMounts,
  resolveUserFileMounts,
} from '@/lib/function-execution/sandbox-mounts'

const WORKSPACE_ID = 'ws-1'
const WORKFLOW_ID = 'wf-1'
const EXECUTION_ID = 'exec-1'

function executionFile(overrides: Partial<UserFile> = {}): UserFile {
  return {
    id: 'file_1',
    name: 'report.csv',
    url: 'https://storage.example/report.csv',
    size: 32,
    type: 'text/csv',
    key: `execution/${WORKSPACE_ID}/${WORKFLOW_ID}/${EXECUTION_ID}/abc/report.csv`,
    context: 'execution',
    ...overrides,
  }
}

function workspaceFile(overrides: Partial<UserFile> = {}): UserFile {
  return {
    id: 'wf_1',
    name: 'brief.pdf',
    url: 'https://storage.example/brief.pdf',
    size: 64,
    type: 'application/pdf',
    key: `workspace/${WORKSPACE_ID}/brief.pdf`,
    context: 'workspace',
    ...overrides,
  }
}

const executionContext = {
  workspaceId: WORKSPACE_ID,
  workflowId: WORKFLOW_ID,
  executionId: EXECUTION_ID,
  userId: 'user-1',
  requestId: 'req-1',
}

describe('planUserFileMounts', () => {
  it('sanitizes names into a single safe path segment', () => {
    const planned = planUserFileMounts([executionFile({ name: 'Q4 Sales (Final).csv' })])

    expect(planned[0].mountPath).toBe('/tmp/sim/inputs/Q4-Sales-_Final_.csv')
  })

  it('cannot be escaped by a traversal in the file name', () => {
    const planned = planUserFileMounts([
      executionFile({ name: '../../etc/passwd' }),
      executionFile({ id: 'file_2', name: '..' }),
    ])

    for (const { mountPath } of planned) {
      expect(mountPath.startsWith('/tmp/sim/inputs/')).toBe(true)
      expect(mountPath).not.toContain('/../')
      expect(mountPath.endsWith('/..')).toBe(false)
    }
  })

  it('suffixes colliding names so neither file is silently overwritten', () => {
    const planned = planUserFileMounts([
      executionFile({ id: 'file_1', name: 'report.csv' }),
      executionFile({ id: 'file_2', name: 'report.csv' }),
      executionFile({ id: 'file_3', name: 'report.csv' }),
    ])

    expect(planned.map((entry) => entry.mountPath)).toEqual([
      '/tmp/sim/inputs/report.csv',
      '/tmp/sim/inputs/report-2.csv',
      '/tmp/sim/inputs/report-3.csv',
    ])
  })
})

describe('resolveUserFileMounts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHasCloudStorage.mockReturnValue(true)
    mockGeneratePresignedDownloadUrl.mockResolvedValue('https://presigned.example/object')
    mockReadWorkspaceFileRecordByKey.mockResolvedValue({ file: { id: 'wf_1' } })
    // Sized from the file being read: the aggregate budget counts bytes actually
    // buffered, so a fixed-size stub would never let the total ceiling trip.
    mockDownloadServableFileFromStorage.mockImplementation(async (file: UserFile) => ({
      buffer: file.size > 16 ? Buffer.alloc(file.size) : Buffer.from('a,b\n1,2'),
      contentType: file.type,
    }))
  })

  it('mounts by presigned URL when cloud storage is configured', async () => {
    const planned = planUserFileMounts([executionFile()])

    const { sandboxFiles, manifest } = await resolveUserFileMounts({
      planned,
      context: executionContext,
    })

    // The sandbox fetches the bytes itself, so nothing transits the web process.
    expect(sandboxFiles).toEqual([
      {
        type: 'url',
        path: '/tmp/sim/inputs/report.csv',
        url: 'https://presigned.example/object',
        // Granted exactly what the mount was charged against the aggregate, so
        // an understated size is refused rather than silently overrunning it.
        maxBytes: 32,
      },
    ])
    expect(mockGeneratePresignedDownloadUrl).toHaveBeenCalledWith(
      planned[0].userFile.key,
      'execution',
      MOUNT_URL_TTL_SECONDS
    )
    expect(mockDownloadServableFileFromStorage).not.toHaveBeenCalled()
    expect(manifest).toEqual([
      { name: 'report.csv', path: '/tmp/sim/inputs/report.csv', size: 32, type: 'text/csv' },
    ])
  })

  it('buffers bytes inline when there is no cloud storage to presign from', async () => {
    mockHasCloudStorage.mockReturnValue(false)

    const { sandboxFiles } = await resolveUserFileMounts({
      planned: planUserFileMounts([executionFile()]),
      context: executionContext,
    })

    // A presigned URL under local storage is an app-internal serve path the
    // remote sandbox cannot reach.
    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
    expect(sandboxFiles).toEqual([
      {
        path: '/tmp/sim/inputs/report.csv',
        content: Buffer.alloc(32).toString('base64'),
        encoding: 'base64',
      },
    ])
  })

  it('rejects a file over the per-file mount ceiling before presigning it', async () => {
    await expect(
      resolveUserFileMounts({
        planned: planUserFileMounts([executionFile({ size: 600 * 1024 * 1024 })]),
        context: executionContext,
      })
    ).rejects.toThrow(/per-file mount limit/)

    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('rejects a batch over the total inline budget', async () => {
    mockHasCloudStorage.mockReturnValue(false)

    await expect(
      resolveUserFileMounts({
        planned: planUserFileMounts([
          executionFile({ id: 'a', name: 'a.bin', size: 9 * 1024 * 1024 }),
          executionFile({ id: 'b', name: 'b.bin', size: 9 * 1024 * 1024 }),
          executionFile({ id: 'c', name: 'c.bin', size: 9 * 1024 * 1024 }),
          executionFile({ id: 'd', name: 'd.bin', size: 9 * 1024 * 1024 }),
          executionFile({ id: 'e', name: 'e.bin', size: 9 * 1024 * 1024 }),
          executionFile({ id: 'f', name: 'f.bin', size: 9 * 1024 * 1024 }),
        ]),
        context: executionContext,
      })
    ).rejects.toThrow(/total mount limit/)
  })

  it('authorizes a design-time workspace upload through its workspace record', async () => {
    const { sandboxFiles } = await resolveUserFileMounts({
      planned: planUserFileMounts([workspaceFile()]),
      context: { ...executionContext, principal: { kind: 'sim_user' } as never },
    })

    // The common case for a Function block: a file pinned in the block config is
    // a workspace key, which never touches the execution-scope check at all.
    expect(mockReadWorkspaceFileRecordByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ key: `workspace/${WORKSPACE_ID}/brief.pdf` }),
      })
    )
    expect(sandboxFiles).toHaveLength(1)
  })

  it('refuses an execution file belonging to a different workflow', async () => {
    const foreign = executionFile({
      key: `execution/${WORKSPACE_ID}/other-workflow/other-exec/xyz/secrets.csv`,
    })

    await expect(
      resolveUserFileMounts({
        planned: planUserFileMounts([foreign]),
        context: executionContext,
      })
    ).rejects.toThrow(/not available in this execution/)

    expect(mockGeneratePresignedDownloadUrl).not.toHaveBeenCalled()
  })

  it('admits an execution file from another run when its key is in the allowlist', async () => {
    const priorRun = executionFile({
      key: `execution/${WORKSPACE_ID}/${WORKFLOW_ID}/earlier-exec/xyz/prior.csv`,
    })

    const { sandboxFiles } = await resolveUserFileMounts({
      planned: planUserFileMounts([priorRun]),
      context: { ...executionContext, fileKeys: [priorRun.key] },
    })

    expect(sandboxFiles).toHaveLength(1)
  })
})
