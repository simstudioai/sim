/**
 * The local-filesystem backend must commit an object atomically, the way every
 * cloud backend does.
 *
 * `headObject` answers local storage from `stat` rather than reporting it as
 * missing, so callers that read "the object is there" as "the copy finished" —
 * the workspace fork copier, the KB document copier, the table snapshot cache —
 * are live on self-hosted and dev deployments. That inference is only sound if a
 * half-written file can never appear under the final key, which means the bytes
 * must land on a sibling path and be renamed over the target: `rename` within a
 * directory is atomic on POSIX, `writeFile` truncates first and is not.
 *
 * The assertion is on the call sequence rather than on an observed torn read.
 * A timing-based test here passes against a plain `writeFile` too — the write of
 * even a multi-megabyte buffer resolves well inside one macrotask — so it would
 * be a test that cannot fail. This one fails the moment the temp-and-rename is
 * replaced by a direct write.
 *
 * @vitest-environment node
 *
 * Under `isolate: false` the storage-service module may already be cached and
 * bound to the real `@/lib/uploads/config` namespace, so a per-file `vi.mock` of
 * that path would never reach it. This file patches the real namespace in place
 * (the `USE_*` flags are value exports read at call time) and restores it after,
 * matching `storage-service.blob-connection-string.test.ts`.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { fs } = vi.hoisted(() => ({
  fs: {
    writeFile: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    mkdir: vi.fn(async () => undefined),
    rm: vi.fn(async () => {}),
    stat: vi.fn(async () => ({ size: 11, isFile: () => true })),
    readFile: vi.fn(async () => Buffer.alloc(0)),
    unlink: vi.fn(async () => {}),
    readdir: vi.fn(async () => []),
    access: vi.fn(async () => {}),
  },
}))

vi.mock('fs/promises', () => ({ ...fs, default: fs }))
vi.mock('node:fs/promises', () => ({ ...fs, default: fs }))

import * as uploadsConfig from '@/lib/uploads/config'
import { UPLOAD_DIR_SERVER } from '@/lib/uploads/core/setup.server'
import { uploadFile } from '@/lib/uploads/core/storage-service'

const KEY = 'workspace/ws-1/doc.txt'
const TARGET = `${UPLOAD_DIR_SERVER}/${KEY}`

const CLOUD_FLAGS = ['USE_S3_STORAGE', 'USE_BLOB_STORAGE', 'USE_GCS_STORAGE'] as const
const originalFlags = new Map(
  CLOUD_FLAGS.map((flag) => [flag, uploadsConfig[flag] as boolean] as const)
)

function setCloudFlags(value: boolean) {
  for (const flag of CLOUD_FLAGS) {
    Object.defineProperty(uploadsConfig, flag, { value, configurable: true })
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  setCloudFlags(false)
})

afterAll(() => {
  for (const [flag, value] of originalFlags) {
    Object.defineProperty(uploadsConfig, flag, { value, configurable: true })
  }
})

function upload() {
  return uploadFile({
    file: Buffer.from('hello world', 'utf8'),
    fileName: 'doc.txt',
    contentType: 'text/plain',
    context: 'workspace',
    customKey: KEY,
    preserveKey: true,
  })
}

describe('local filesystem uploads', () => {
  it('writes to a sibling temp path and renames it onto the target', async () => {
    await upload()

    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    const [writtenPath] = fs.writeFile.mock.calls[0] as [string]
    expect(writtenPath).toMatch(new RegExp(`^${TARGET}\\.[A-Za-z0-9_-]+\\.partial$`))
    expect(fs.rename).toHaveBeenCalledWith(writtenPath, TARGET)
  })

  it('never writes directly to the key readers resolve', async () => {
    await upload()

    const targets = fs.writeFile.mock.calls.map(([path]) => path)
    expect(targets).not.toContain(TARGET)
  })

  it('removes the temp file and surfaces the error when the write fails', async () => {
    const failure = new Error('ENOSPC: no space left on device')
    fs.writeFile.mockRejectedValueOnce(failure)

    await expect(upload()).rejects.toThrow(failure)

    const [writtenPath] = fs.writeFile.mock.calls[0] as [string]
    expect(fs.rename).not.toHaveBeenCalled()
    expect(fs.rm).toHaveBeenCalledWith(writtenPath, { force: true })
  })

  it('removes the temp file when the rename itself fails', async () => {
    fs.rename.mockRejectedValueOnce(new Error('EXDEV: cross-device link'))

    await expect(upload()).rejects.toThrow('EXDEV')

    const [writtenPath] = fs.writeFile.mock.calls[0] as [string]
    expect(fs.rm).toHaveBeenCalledWith(writtenPath, { force: true })
  })
})
