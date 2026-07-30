/**
 * @vitest-environment node
 *
 * Builds are addressed by content and shared across workspaces, so releasing one
 * eagerly is only safe while nothing else references it. These cases pin that
 * guard down, plus the failure modes that must leave the retention sweep a job to
 * finish rather than losing the image silently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDelete, mockInsert, mockDeleteImage, mockProviderStrategy } = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockInsert: vi.fn(),
  mockDeleteImage: vi.fn(),
  mockProviderStrategy: { current: 'prebuilt' as 'prebuilt' | 'runtime' },
}))

vi.mock('@sim/db', () => ({
  db: { delete: mockDelete, insert: mockInsert },
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
  notInArray: (...args: unknown[]) => args,
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

import {
  ensureSandboxImage,
  FAILED_BUILD_RETRY_COOLDOWN_MS,
  releaseSandboxImage,
} from '@/lib/execution/remote-sandbox/image-registry'

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
  mockDelete.mockReturnValue({ where: () => ({ returning: () => Promise.resolve([]) }) })
  mockInsert.mockReturnValue({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) })
  mockDeleteImage.mockResolvedValue(undefined)
})

/** Serializes the mocked predicate tree so a clause can be asserted by shape. */
function predicateText(predicate: unknown): string {
  if (predicate == null) return ''
  if (Array.isArray(predicate)) return predicate.map(predicateText).join(' ')
  if (typeof predicate === 'object') return JSON.stringify(predicate)
  return String(predicate)
}

/** Captures the conditional-delete predicate and what the claim resolves to. */
function stubClaim(rows: unknown[]): () => unknown {
  let captured: unknown
  mockDelete.mockReturnValue({
    where: (predicate: unknown) => {
      captured = predicate
      return { returning: () => Promise.resolve(rows) }
    },
  })
  return () => captured
}

describe('releaseSandboxImage', () => {
  it('deletes the provider image once the row is claimed', async () => {
    stubClaim([READY_IMAGE])

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).toHaveBeenCalledWith({
      imageRef: 'sim-sbx-abc',
      buildId: 'build-1',
      providerImageId: 'tmpl-1',
    })
  })

  /**
   * The bystander case: two workspaces declaring the same package list share one
   * build, so one workspace's delete must not take the image out from under the
   * other. The guard is the conditional delete itself — reading references in a
   * separate statement left a window, spanning a provider network call, in which
   * another workspace could adopt the hash between the check and the delete.
   */
  it('claims only when no sandbox references the hash, in one statement', async () => {
    const read = stubClaim([READY_IMAGE])

    await releaseSandboxImage('hash-1')

    const clause = predicateText(read())
    expect(clause).toContain('not exists')
    expect(clause).toContain('workspace_sandbox')
  })

  it('excludes an in-flight build from the claim rather than racing it', async () => {
    const read = stubClaim([READY_IMAGE])

    await releaseSandboxImage('hash-1')

    const clause = predicateText(read())
    expect(clause).toContain('pending')
    expect(clause).toContain('building')
  })

  it('touches the provider only when the claim actually took a row', async () => {
    stubClaim([])

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  it('no-ops under a runtime provider, which has no images to release', async () => {
    mockProviderStrategy.current = 'runtime'
    stubClaim([READY_IMAGE])

    await releaseSandboxImage('hash-1')

    expect(mockDelete).not.toHaveBeenCalled()
    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  /**
   * Claiming before the provider call means a refusal would otherwise strand a
   * template nothing points at, so the row goes back and the sweep inherits it.
   */
  it('restores the claimed row when the provider refuses', async () => {
    stubClaim([READY_IMAGE])
    mockDeleteImage.mockRejectedValue(new Error('E2B unreachable'))

    await expect(releaseSandboxImage('hash-1')).resolves.toBeUndefined()

    expect(mockInsert).toHaveBeenCalledTimes(1)
  })

  it('skips the provider when the claimed row never had an image', async () => {
    stubClaim([{ ...READY_IMAGE, imageRef: null }])

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

/** True when any leaf of the mocked predicate tree is a `Date`, i.e. a time bound. */
function hasTimeBound(predicate: unknown): boolean {
  if (predicate instanceof Date) return true
  return Array.isArray(predicate) && predicate.some(hasTimeBound)
}

/**
 * The repair path fires once per execution, so re-claiming a failed row on sight
 * would let a per-minute schedule enqueue a per-minute build of a package list
 * that will never resolve. A save is a person asking again and must not wait.
 */
describe('ensureSandboxImage failed-build cooldown', () => {
  const SPEC = { language: 'python' as const, dependencies: ['pandas'] }

  /** Captures the conflict predicate; the empty `returning` means "nothing claimed". */
  function captureSetWhere(): () => unknown {
    let captured: unknown
    mockInsert.mockReturnValue({
      values: () => ({
        onConflictDoUpdate: (config: { setWhere: unknown }) => {
          captured = config.setWhere
          return { returning: () => Promise.resolve([]) }
        },
      }),
    })
    return () => captured
  }

  it('bounds the failed branch by time when a cooldown is requested', async () => {
    const read = captureSetWhere()

    await ensureSandboxImage(SPEC, 'hash-1', {
      minFailureAgeMs: FAILED_BUILD_RETRY_COOLDOWN_MS,
    })

    const [failedBranch] = read() as unknown[]
    expect(hasTimeBound(failedBranch)).toBe(true)
  })

  it('leaves the failed branch unbounded for a save, so a person retries at once', async () => {
    const read = captureSetWhere()

    await ensureSandboxImage(SPEC, 'hash-1')

    const [failedBranch] = read() as unknown[]
    expect(hasTimeBound(failedBranch)).toBe(false)
  })
})
