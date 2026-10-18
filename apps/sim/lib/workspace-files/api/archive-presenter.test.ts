/** @vitest-environment node */
import { Readable } from 'node:stream'
import { flushMacrotask } from '@sim/testing/helpers'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getMockLogger } from '@sim/testing/mocks/logger.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import JSZip from 'jszip'
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace'

vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)

import { presentWorkspaceFileArchive } from '@/lib/workspace-files/api/archive-presenter'

const deliveryLogger = getMockLogger('FileArchiveDelivery')

function plan() {
  const filesToZip: WorkspaceFileRecord[] = Array.from({ length: 3 }, (_, index) => ({
    id: `file-${index}`,
    workspaceId: 'workspace',
    name: `${index}.txt`,
    key: `workspace/${index}`,
    path: `/files/${index}`,
    size: 131072,
    type: 'text/plain',
    uploadedBy: 'creator',
    uploadedAt: new Date(0),
    updatedAt: new Date(0),
  }))
  return {
    filesToZip,
    excludedFileIds: [],
    folderPaths: new Map<string, string>(),
    renderedDocuments: new Map<string, Buffer>(),
    declaredBytes: 393216,
  }
}

describe('file archive resource lifetime', () => {
  it('keeps only one storage stream open while preserving every entry', async () => {
    let active = 0
    let peak = 0
    storageServiceMockFns.mockDownloadFileStream.mockImplementation(async () => {
      active++
      peak = Math.max(peak, active)
      const source = Readable.from(
        (async function* () {
          yield Buffer.alloc(65536, 'a')
          await flushMacrotask()
          yield Buffer.alloc(65536, 'b')
        })()
      )
      let released = false
      const release = () => {
        if (!released) {
          released = true
          active--
        }
      }
      source.once('end', release)
      source.once('close', release)
      return source
    })
    const result = presentWorkspaceFileArchive(plan())
    const zip = await JSZip.loadAsync(await new Response(result.body).arrayBuffer())
    for (const name of ['0.txt', '1.txt', '2.txt']) {
      expect(await zip.file(name)?.async('string')).toBe('a'.repeat(65536) + 'b'.repeat(65536))
    }
    expect(peak).toBe(1)
    expect(active).toBe(0)
  })

  it('rejects partial storage failure and closes the input', async () => {
    const source = Readable.from(
      (async function* () {
        yield Buffer.from('partial')
        throw new Error('Storage unavailable')
      })()
    )
    storageServiceMockFns.mockDownloadFileStream.mockResolvedValue(source)
    const result = presentWorkspaceFileArchive(plan())
    await expect(new Response(result.body).arrayBuffer()).rejects.toThrow('Storage unavailable')
    expect(source.destroyed).toBe(true)
  })

  it('closes a storage stream acquired after the client cancels', async () => {
    const acquiring = createDeferred<void>()
    const acquired = createDeferred<Readable>()
    const source = new Readable({ read() {} })
    storageServiceMockFns.mockDownloadFileStream.mockImplementationOnce(() => {
      acquiring.resolve()
      return acquired.promise
    })
    const reader = presentWorkspaceFileArchive(plan()).body.getReader()
    try {
      await acquiring.promise
      await reader.cancel()
      acquired.resolve(source)
      await vi.waitFor(() => expect(source.destroyed).toBe(true))
    } finally {
      acquired.resolve(source)
      source.destroy()
    }
  })

  it('closes the active source when the client cancels', async () => {
    const source = new Readable({
      read() {
        this.push(Buffer.alloc(65536))
      },
    })
    storageServiceMockFns.mockDownloadFileStream.mockResolvedValue(source)
    const reader = presentWorkspaceFileArchive(plan()).body.getReader()
    await reader.read()
    await reader.cancel()
    await vi.waitFor(() => expect(source.destroyed).toBe(true))
  })

  /** A storage response torn down mid-read fails with Node's bare `aborted`, not an AbortError. */
  function storageStreamThatFailsWhenDestroyed() {
    return new Readable({
      read() {
        this.push(Buffer.alloc(65536))
      },
      destroy(_error, callback) {
        callback(new Error('aborted'))
      },
    })
  }

  it('does not log a failure when the client disconnects mid-download', async () => {
    deliveryLogger.error.mockClear()
    const source = storageStreamThatFailsWhenDestroyed()
    storageServiceMockFns.mockDownloadFileStream.mockResolvedValue(source)
    const reader = presentWorkspaceFileArchive(plan()).body.getReader()
    await reader.read()
    const disconnect = new Error('')
    disconnect.name = 'ResponseAborted'
    await reader.cancel(disconnect)
    await vi.waitFor(() => expect(source.destroyed).toBe(true))
    await flushMacrotask()

    expect(deliveryLogger.error).not.toHaveBeenCalled()
  })

  it('still logs a storage failure while the client is connected', async () => {
    deliveryLogger.error.mockClear()
    const source = storageStreamThatFailsWhenDestroyed()
    storageServiceMockFns.mockDownloadFileStream.mockResolvedValue(source)
    const result = presentWorkspaceFileArchive(plan())
    const reader = result.body.getReader()
    await reader.read()
    source.destroy()

    await expect(
      (async () => {
        while (!(await reader.read()).done) {}
      })()
    ).rejects.toThrow('aborted')
    expect(deliveryLogger.error).toHaveBeenCalledWith(
      'Failed to build file archive',
      expect.anything()
    )
  })
})
