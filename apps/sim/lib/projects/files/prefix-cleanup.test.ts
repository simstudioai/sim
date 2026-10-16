import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { resetDbChainMock } from '@sim/testing'
import { uploadsConfigMock } from '@sim/testing/mocks/uploads-config.mock'
import { uploadsMetadataMock } from '@sim/testing/mocks/uploads-metadata.mock'
import { setUploadDirServer, uploadsSetupMock } from '@sim/testing/mocks/uploads-setup.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
vi.mock('@/lib/uploads/config', () => uploadsConfigMock)
vi.mock('@/lib/uploads/server/metadata', () => uploadsMetadataMock)

import type { OutboxEventContext } from '@/lib/core/outbox/service'
import { PROJECT_FILE_PREFIX_CLEANUP_EVENT } from '@/lib/projects/files/outbox-events'
import { projectFilePrefixCleanupOutboxHandlers } from '@/lib/projects/files/prefix-cleanup'

const cleanup = projectFilePrefixCleanupOutboxHandlers[PROJECT_FILE_PREFIX_CLEANUP_EVENT]

let root: string

function outboxContext(deadlineAt?: number): OutboxEventContext {
  return {
    eventId: 'event-1',
    eventType: PROJECT_FILE_PREFIX_CLEANUP_EVENT,
    attempts: 0,
    maxAttempts: 10,
    signal: new AbortController().signal,
    ...(deadlineAt ? { deadlineAt } : {}),
    checkpointPayload: vi.fn(async () => {}),
  }
}

async function put(key: string): Promise<void> {
  await mkdir(dirname(join(root, key)), { recursive: true })
  await writeFile(join(root, key), 'x')
}

async function exists(key: string): Promise<boolean> {
  try {
    await stat(join(root, key))
    return true
  } catch {
    return false
  }
}

describe('Project prefix cleanup on local storage', () => {
  beforeEach(async () => {
    resetDbChainMock()
    root = await mkdtemp(join(tmpdir(), 'sim-project-prefix-'))
    setUploadDirServer(root)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('deletes the retired Project prefix and completes', async () => {
    await put('project/p1/a.txt')
    await put('project/p1/nested/b.txt')
    await put('project/p10/keep.txt')

    await expect(cleanup({ projectId: 'p1' }, outboxContext())).resolves.toBeUndefined()

    expect(await exists('project/p1/a.txt')).toBe(false)
    expect(await exists('project/p1/nested/b.txt')).toBe(false)
    expect(await exists('project/p10/keep.txt')).toBe(true)
  })

  it('spends an attempt when a full page holds only objects it cannot remove', async () => {
    for (let index = 0; index < 520; index++) await put(`project/p1/legacy file ${index}.txt`)

    const result = await cleanup({ projectId: 'p1' }, outboxContext(Date.now() + 60_000))

    expect(result).toMatchObject({ outcome: 'deferred' })
    expect(result).not.toMatchObject({ consumeAttempt: false })
  })
})
