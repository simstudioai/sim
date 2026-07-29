/**
 * @vitest-environment node
 *
 * Builds are addressed by content and shared across workspaces, so releasing one
 * eagerly is only safe while nothing else references it. These cases pin that
 * guard down, plus the failure modes that must leave the retention sweep a job to
 * finish rather than losing the image silently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSelect, mockDelete, mockDeleteImage, mockProviderStrategy } = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteImage: vi.fn(),
  mockProviderStrategy: { current: 'prebuilt' as 'prebuilt' | 'runtime' },
}))

vi.mock('@sim/db', () => ({
  db: { select: mockSelect, delete: mockDelete },
}))

vi.mock('@sim/db/schema', () => ({
  sandboxImage: {
    id: 'id',
    provider: 'provider',
    specHash: 'spec_hash',
    status: 'status',
    imageRef: 'image_ref',
    buildId: 'build_id',
    providerImageId: 'provider_image_id',
    lastUsedAt: 'last_used_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  workspaceSandbox: { id: 'id', specHash: 'spec_hash' },
}))

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => args,
  eq: (...args: unknown[]) => args,
  inArray: (...args: unknown[]) => args,
  lt: (...args: unknown[]) => args,
  or: (...args: unknown[]) => args,
  sql: (...args: unknown[]) => args,
}))

vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({
    id: 'e2b',
    get dependencyStrategy() {
      return mockProviderStrategy.current
    },
    get images() {
      return mockProviderStrategy.current === 'prebuilt'
        ? { deleteImage: mockDeleteImage }
        : undefined
    },
  }),
}))

import { releaseSandboxImage } from '@/lib/execution/remote-sandbox/image-registry'

/** Queues the rows each successive `db.select()` chain resolves to. */
function queueSelects(...results: unknown[][]) {
  mockSelect.mockReset()
  for (const rows of results) {
    mockSelect.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    })
  }
}

const READY_IMAGE = {
  id: 'img-1',
  status: 'ready',
  imageRef: 'sim-sbx-abc',
  buildId: 'build-1',
  providerImageId: 'tmpl-1',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockProviderStrategy.current = 'prebuilt'
  mockDelete.mockReturnValue({ where: () => Promise.resolve() })
  mockDeleteImage.mockResolvedValue(undefined)
})

describe('releaseSandboxImage', () => {
  it('deletes the provider image and its row when nothing references the hash', async () => {
    queueSelects([], [READY_IMAGE])

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).toHaveBeenCalledWith({
      imageRef: 'sim-sbx-abc',
      buildId: 'build-1',
      providerImageId: 'tmpl-1',
    })
    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  /**
   * The case that would break a bystander: two workspaces declaring the same
   * package list share one build, so one workspace deleting its sandbox must not
   * delete the image out from under the other.
   */
  it('leaves the image alone while another sandbox still declares that package list', async () => {
    // A releasable image IS queued behind the reference lookup on purpose: without
    // it, dropping the guard would fault on the missing second select and get
    // swallowed, and this test would pass for the wrong reason.
    queueSelects([{ id: 'sbx-other' }], [READY_IMAGE])

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('no-ops under a runtime provider, which has no images to release', async () => {
    mockProviderStrategy.current = 'runtime'
    queueSelects([], [READY_IMAGE])

    await releaseSandboxImage('hash-1')

    expect(mockSelect).not.toHaveBeenCalled()
    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  it.each(['pending', 'building'])(
    'leaves a %s build for the sweep rather than racing it',
    async (status) => {
      queueSelects([], [{ ...READY_IMAGE, status }])

      await releaseSandboxImage('hash-1')

      expect(mockDeleteImage).not.toHaveBeenCalled()
      expect(mockDelete).not.toHaveBeenCalled()
    }
  )

  it('keeps the row when the provider refuses, so the sweep retries', async () => {
    queueSelects([], [READY_IMAGE])
    mockDeleteImage.mockRejectedValue(new Error('E2B unreachable'))

    await expect(releaseSandboxImage('hash-1')).resolves.toBeUndefined()

    expect(mockDelete).not.toHaveBeenCalled()
  })

  it('does nothing when the hash has no build row at all', async () => {
    queueSelects([], [])

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).not.toHaveBeenCalled()
    expect(mockDelete).not.toHaveBeenCalled()
  })
})
