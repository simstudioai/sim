import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  largeValueMetadataMock,
  largeValueMetadataMockFns,
} from '@sim/testing/mocks/large-value-metadata.mock'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import {
  uploadsMetadataMock,
  uploadsMetadataMockFns,
} from '@sim/testing/mocks/uploads-metadata.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { describeError } from '@sim/utils/errors'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)
vi.mock('@/lib/execution/payloads/large-value-metadata', () => largeValueMetadataMock)

import { storeLargeValue } from '@/lib/execution/payloads/store'

const { mockInsertFileMetadata, mockDeleteFileMetadata } = uploadsMetadataMockFns
const scope = { workspaceId: 'workspace-1', workflowId: 'workflow-1', executionId: 'execution-1' }

let directory: string

async function storedObjects(): Promise<string[]> {
  try {
    return await readdir(join(directory, 'execution', ...Object.values(scope)))
  } catch (error) {
    if (describeError(error).code === 'ENOENT') return []
    throw error
  }
}

describe('large value persistence against real local storage', () => {
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'sim-large-value-'))
    setUploadDirServer(directory)
    mockInsertFileMetadata.mockReset().mockResolvedValue({ id: 'file-1' })
    mockDeleteFileMetadata.mockReset().mockResolvedValue(true)
    largeValueMetadataMockFns.mockRegisterLargeValueOwner.mockResolvedValue(true)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('removes the uploaded object when its metadata row cannot be written', async () => {
    mockInsertFileMetadata.mockRejectedValueOnce(new Error('workspace no longer exists'))
    const json = JSON.stringify({ payload: 'x'.repeat(2048) })

    await expect(
      storeLargeValue(JSON.parse(json), json, Buffer.byteLength(json), {
        ...scope,
        userId: 'user-1',
        requireDurable: true,
      })
    ).rejects.toThrow('Failed to persist large execution value')

    expect(await storedObjects()).toEqual([])
    expect(largeValueMetadataMockFns.mockRegisterLargeValueOwner).not.toHaveBeenCalled()
  })

  it('keeps the object once its metadata row is written', async () => {
    const json = JSON.stringify({ payload: 'y'.repeat(2048) })

    const ref = await storeLargeValue(JSON.parse(json), json, Buffer.byteLength(json), {
      ...scope,
      userId: 'user-1',
      requireDurable: true,
    })

    expect((await storedObjects()).filter((name) => name.endsWith('.json'))).toEqual([
      ref.key?.split('/').pop(),
    ])
  })
})
