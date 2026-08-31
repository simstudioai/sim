/**
 * @vitest-environment node
 *
 * Builds are addressed by content and shared across workspaces, so releasing one
 * eagerly is only safe while nothing else references it. These cases pin that
 * guard down, plus the failure modes that must leave the retention sweep a job to
 * finish rather than losing the image silently.
 */
import { createMockSql } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDelete,
  mockInsert,
  mockSelect,
  mockUpdate,
  mockDeleteImage,
  mockStartBuild,
  mockGetBuildStatus,
  mockProviderStrategy,
  mockRecordSandboxCliBuildFailure,
  mockRecordSandboxImageCleanupFailure,
  mockRunDetached,
  mockSleep,
  mockMaterialization,
  mockRendererRevision,
} = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockInsert: vi.fn(),
  mockSelect: vi.fn(),
  mockUpdate: vi.fn(),
  mockDeleteImage: vi.fn(),
  mockStartBuild: vi.fn(),
  mockGetBuildStatus: vi.fn(),
  mockProviderStrategy: { current: 'prebuilt' as 'prebuilt' | 'runtime' },
  mockRecordSandboxCliBuildFailure: vi.fn(),
  mockRecordSandboxImageCleanupFailure: vi.fn(),
  mockRunDetached: vi.fn(),
  mockSleep: vi.fn().mockResolvedValue(undefined),
  mockMaterialization: {
    current: {
      rendererRevision: 1,
      generation: 1785792000000001,
      imageRefPrefix: 'sim-sbx-current:',
      baseImageRef: 'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479',
    },
  },
  mockRendererRevision: { current: 1 },
}))

vi.mock('@sim/db', () => ({
  db: { delete: mockDelete, insert: mockInsert, select: mockSelect, update: mockUpdate },
}))

vi.mock('@/lib/core/execution-limits/metrics', () => ({
  recordSandboxCliBuildFailure: mockRecordSandboxCliBuildFailure,
  recordSandboxImageCleanupFailure: mockRecordSandboxImageCleanupFailure,
}))

vi.mock('@/lib/core/utils/background', () => ({ runDetached: mockRunDetached }))

vi.mock('@sim/utils/helpers', () => ({ sleep: mockSleep }))

vi.mock('@sim/db/schema', () => ({
  sandboxImage: {
    id: 'id',
    provider: 'provider',
    specHash: 'spec_hash',
    status: 'status',
    imageRef: 'image_ref',
    buildId: 'build_id',
    providerImageId: 'provider_image_id',
    materializationGeneration: 'materialization_generation',
    errorCode: 'error_code',
    errorMessage: 'error_message',
    errorDetail: 'error_detail',
    spec: 'spec',
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
  sql: createMockSql(),
}))

vi.mock('@/lib/execution/remote-sandbox/provider', () => ({
  resolveProvider: () => ({
    id: 'e2b',
    get dependencyStrategy() {
      return mockProviderStrategy.current
    },
    get images() {
      return mockProviderStrategy.current === 'prebuilt'
        ? {
            get rendererRevision() {
              return mockRendererRevision.current
            },
            deleteImage: mockDeleteImage,
            startBuild: mockStartBuild,
            getBuildStatus: mockGetBuildStatus,
            materialization: () => ({ ...mockMaterialization.current }),
            imageRefGeneration: vi.fn(),
          }
        : undefined
    },
  }),
}))

import {
  cleanupSandboxImages,
  ensureSandboxImage,
  FAILED_BUILD_RETRY_COOLDOWN_MS,
  releaseSandboxImage,
  runSandboxImageBuild,
  SANDBOX_IMAGE_BUILD_TASK_ID,
  sandboxBuildIdempotencyKey,
} from '@/lib/execution/remote-sandbox/image-registry'

const READY_IMAGE = {
  id: 'img-1',
  status: 'ready',
  spec: { language: 'python', dependencies: ['pandas'], cliTools: [], systemPackages: [] },
  imageRef: 'sim-sbx-abc',
  buildId: 'build-1',
  providerImageId: 'tmpl-1',
  materializationGeneration: 1785792000000001,
  errorCode: 'base_release_refresh',
  errorMessage: 'replacement failed',
  errorDetail: 'provider log tail',
  lastUsedAt: new Date('2026-08-01T00:00:00.000Z'),
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:00.000Z'),
}

const CURRENT_MATERIALIZATION = {
  rendererRevision: 1,
  generation: 1785792000000001,
  imageRefPrefix: 'sim-sbx-current:',
  baseImageRef: 'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockProviderStrategy.current = 'prebuilt'
  mockRendererRevision.current = 1
  mockMaterialization.current = {
    rendererRevision: 1,
    generation: 1785792000000001,
    imageRefPrefix: 'sim-sbx-current:',
    baseImageRef: 'sim-function:f47ac10b-58cc-4372-a567-0e02b2c3d479',
  }
  mockDelete.mockReturnValue({ where: () => ({ returning: () => Promise.resolve([]) }) })
  mockUpdate.mockReturnValue({
    set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
  })
  mockInsert.mockReturnValue({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) })
  // Default: nothing re-adopted the hash, so the post-delete rebuild is a no-op and
  // cases that are not about it stay on one `delete`.
  mockSelect.mockReturnValue({
    from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
  })
  mockDeleteImage.mockResolvedValue(undefined)
})

describe('runSandboxImageBuild metrics', () => {
  it.each([
    [
      'managed CLI',
      {
        language: 'python' as const,
        dependencies: [],
        cliTools: ['google-cloud-cli@577.0.0-r1' as const],
        systemPackages: [],
      },
    ],
    [
      'system package',
      {
        language: 'python' as const,
        dependencies: [],
        cliTools: [],
        systemPackages: ['jq'],
      },
    ],
  ])('records a bounded failure metric when a %s image cannot start building', async (_, spec) => {
    mockUpdate
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({ returning: () => Promise.resolve([{ spec }]) }),
        }),
      })
      .mockReturnValueOnce({
        set: () => ({ where: () => Promise.resolve() }),
      })
    mockStartBuild.mockRejectedValueOnce(new Error('provider unavailable'))

    await runSandboxImageBuild({ provider: 'e2b', specHash: 'hash-1' })

    expect(mockRecordSandboxCliBuildFailure).toHaveBeenCalledWith({ provider: 'e2b' })
    expect(mockRecordSandboxCliBuildFailure).toHaveBeenCalledTimes(1)
  })
})

describe('runSandboxImageBuild release replacement', () => {
  const SPEC = {
    language: 'python' as const,
    dependencies: ['pandas'],
    cliTools: [],
    systemPackages: [],
  }
  const REPLACEMENT = {
    imageRef: 'sim-sbx-current:new-build',
    buildId: 'new-build',
    providerImageId: 'new-family',
  }

  function stubReadyBuild(options: {
    committed: boolean
    committedProviderImageId?: string | null
    supersededProviderImageId?: string | null
    committedRow?: { status: string; imageRef: string; providerImageId: string | null } | null
  }): void {
    mockUpdate
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.resolve([
                {
                  spec: SPEC,
                  imageRef: 'sim-sbx-previous:old-build',
                  buildId: 'old-build',
                  providerImageId: options.supersededProviderImageId ?? 'old-family',
                },
              ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: () => Promise.resolve(options.committed ? [{ id: 'image-1' }] : []),
          }),
        }),
      })
    mockStartBuild.mockResolvedValueOnce(REPLACEMENT)
    mockGetBuildStatus.mockResolvedValueOnce({ status: 'ready' })
    const committedRow =
      options.committedRow === undefined
        ? {
            status: 'ready',
            imageRef: REPLACEMENT.imageRef,
            providerImageId: REPLACEMENT.providerImageId,
          }
        : options.committedRow
    mockSelect.mockReturnValue({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              options.committed
                ? committedRow
                  ? [committedRow]
                  : []
                : options.committedProviderImageId === undefined
                  ? []
                  : [
                      {
                        status: 'ready',
                        providerImageId: options.committedProviderImageId,
                      },
                    ]
            ),
        }),
      }),
    })
  }

  it('deletes the prior child only after a different-family replacement commits', async () => {
    stubReadyBuild({ committed: true, supersededProviderImageId: 'old-family' })

    await runSandboxImageBuild(
      { provider: 'e2b', specHash: 'hash-1' },
      { supersededDeleteGraceMs: 0 }
    )

    expect(mockDeleteImage).toHaveBeenCalledWith({
      imageRef: 'sim-sbx-previous:old-build',
      buildId: 'old-build',
      providerImageId: 'old-family',
    })
  })

  it('retains the prior child when E2B reports the same template family', async () => {
    stubReadyBuild({ committed: true, supersededProviderImageId: 'new-family' })

    await runSandboxImageBuild(
      { provider: 'e2b', specHash: 'hash-1' },
      { supersededDeleteGraceMs: 0 }
    )

    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  it('waits for resolved old refs to drain before deleting the prior child', async () => {
    stubReadyBuild({ committed: true, supersededProviderImageId: 'old-family' })

    await runSandboxImageBuild({
      provider: 'e2b',
      specHash: 'hash-1',
      materialization: CURRENT_MATERIALIZATION,
    })

    expect(mockSleep).toHaveBeenCalledWith(60_000)
    expect(mockDeleteImage).toHaveBeenCalled()
  })

  it('retains the prior child when the committed replacement changes during the grace', async () => {
    stubReadyBuild({
      committed: true,
      supersededProviderImageId: 'old-family',
      committedRow: {
        status: 'ready',
        imageRef: 'sim-sbx-newer:winner',
        providerImageId: 'winner-family',
      },
    })

    await runSandboxImageBuild(
      { provider: 'e2b', specHash: 'hash-1', materialization: CURRENT_MATERIALIZATION },
      { supersededDeleteGraceMs: 0 }
    )

    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  it('retains an uncommitted child when no committed row proves another family', async () => {
    stubReadyBuild({ committed: false })

    await runSandboxImageBuild(
      { provider: 'e2b', specHash: 'hash-1' },
      { supersededDeleteGraceMs: 0 }
    )

    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  it('retains an uncommitted child when the committed row uses the same family', async () => {
    stubReadyBuild({ committed: false, committedProviderImageId: 'new-family' })

    await runSandboxImageBuild(
      { provider: 'e2b', specHash: 'hash-1' },
      { supersededDeleteGraceMs: 0 }
    )

    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  it('deletes an uncommitted child only when a committed row proves another family', async () => {
    stubReadyBuild({ committed: false, committedProviderImageId: 'winner-family' })

    await runSandboxImageBuild(
      { provider: 'e2b', specHash: 'hash-1' },
      { supersededDeleteGraceMs: 0 }
    )

    expect(mockDeleteImage).toHaveBeenCalledWith(REPLACEMENT)
  })

  it('retains an uncommitted child when the registry cannot prove the active family', async () => {
    stubReadyBuild({ committed: false })
    mockSelect.mockImplementationOnce(() => {
      throw new Error('registry unavailable')
    })

    await runSandboxImageBuild(
      { provider: 'e2b', specHash: 'hash-1' },
      { supersededDeleteGraceMs: 0 }
    )

    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  it('deletes a failed candidate whose family is distinct from the retained fallback', async () => {
    let finishDelete: (() => void) | undefined
    mockDeleteImage.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishDelete = resolve
      })
    )
    mockUpdate
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.resolve([
                {
                  spec: SPEC,
                  imageRef: 'sim-sbx-previous:old-build',
                  buildId: 'old-build',
                  providerImageId: 'old-family',
                  errorCode: 'base_release_refresh',
                },
              ]),
          }),
        }),
      })
      .mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })
    mockStartBuild.mockResolvedValueOnce(REPLACEMENT)
    mockGetBuildStatus.mockResolvedValueOnce({
      status: 'failed',
      error: { code: 'install_failed', message: 'Install failed.' },
    })

    const run = runSandboxImageBuild({
      provider: 'e2b',
      specHash: 'hash-1',
      materialization: CURRENT_MATERIALIZATION,
    })

    await vi.waitFor(() => expect(mockDeleteImage).toHaveBeenCalledWith(REPLACEMENT))
    expect(mockUpdate).toHaveBeenCalledTimes(1)
    finishDelete?.()
    await run
    expect(mockUpdate).toHaveBeenCalledTimes(2)
    expect(mockDeleteImage).toHaveBeenCalledWith(REPLACEMENT)
  })

  it('retains a failed candidate when it shares the fallback family', async () => {
    mockUpdate
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.resolve([
                {
                  spec: SPEC,
                  imageRef: 'sim-sbx-previous:old-build',
                  buildId: 'old-build',
                  providerImageId: REPLACEMENT.providerImageId,
                  errorCode: 'base_release_refresh',
                },
              ]),
          }),
        }),
      })
      .mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })
    mockStartBuild.mockResolvedValueOnce(REPLACEMENT)
    mockGetBuildStatus.mockResolvedValueOnce({ status: 'failed' })

    await runSandboxImageBuild({
      provider: 'e2b',
      specHash: 'hash-1',
      materialization: CURRENT_MATERIALIZATION,
    })

    expect(mockDeleteImage).not.toHaveBeenCalled()
  })

  it('records a bounded metric when failed-candidate cleanup is refused', async () => {
    mockUpdate
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.resolve([
                {
                  spec: SPEC,
                  imageRef: null,
                  buildId: null,
                  providerImageId: null,
                  errorCode: null,
                },
              ]),
          }),
        }),
      })
      .mockReturnValueOnce({ set: () => ({ where: () => Promise.resolve() }) })
    mockStartBuild.mockResolvedValueOnce(REPLACEMENT)
    mockGetBuildStatus.mockResolvedValueOnce({ status: 'failed' })
    mockDeleteImage.mockRejectedValueOnce(new Error('provider unavailable'))

    await runSandboxImageBuild({
      provider: 'e2b',
      specHash: 'hash-1',
      materialization: CURRENT_MATERIALIZATION,
    })

    expect(mockRecordSandboxImageCleanupFailure).toHaveBeenCalledWith({
      provider: 'e2b',
      reason: 'failed_candidate',
    })
  })
})

/** True when a mocked SQL predicate contains the exact claim token object. */
function containsReference(predicate: unknown, target: unknown): boolean {
  if (predicate === target) return true
  return Array.isArray(predicate) && predicate.some((value) => containsReference(value, target))
}

describe('runSandboxImageBuild attempt ownership', () => {
  const SPEC = {
    language: 'python' as const,
    dependencies: ['pandas'],
    cliTools: [],
    systemPackages: [],
  }

  it('uses one stable Trigger.dev task ID', () => {
    expect(SANDBOX_IMAGE_BUILD_TASK_ID).toBe('sandbox-image-build')
  })

  it('refuses an app-new/task-old renderer mismatch before claiming the row', async () => {
    await runSandboxImageBuild({
      provider: 'e2b',
      specHash: 'hash-1',
      materialization: { ...CURRENT_MATERIALIZATION, rendererRevision: 2 },
    })

    expect(mockUpdate).not.toHaveBeenCalled()
    expect(mockStartBuild).not.toHaveBeenCalled()
  })

  it('supersedes an old-web payload when the new worker is promoted first', async () => {
    const oldMaterialization = {
      ...CURRENT_MATERIALIZATION,
      rendererRevision: 1,
      generation: CURRENT_MATERIALIZATION.generation - 1001,
      imageRefPrefix: 'sim-sbx-previous:',
    }
    mockRendererRevision.current = 2
    mockMaterialization.current = {
      ...CURRENT_MATERIALIZATION,
      rendererRevision: 2,
      generation: CURRENT_MATERIALIZATION.generation,
    }
    let advancedSet: Record<string, unknown> | undefined
    let advancedPredicate: unknown
    const updatedAt = new Date('2026-08-03T12:00:00.000Z')
    mockUpdate
      .mockReturnValueOnce({
        set: (values: Record<string, unknown>) => {
          advancedSet = values
          return {
            where: (predicate: unknown) => {
              advancedPredicate = predicate
              return { returning: () => Promise.resolve([{ updatedAt }]) }
            },
          }
        },
      })
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({
            returning: () =>
              Promise.resolve([
                {
                  spec: SPEC,
                  imageRef: null,
                  buildId: null,
                  providerImageId: null,
                  errorCode: null,
                },
              ]),
          }),
        }),
      })
      .mockReturnValueOnce({
        set: () => ({
          where: () => ({ returning: () => Promise.resolve([{ id: 'image-1' }]) }),
        }),
      })
    mockStartBuild.mockResolvedValueOnce({
      imageRef: 'sim-sbx-current:new-build',
      buildId: 'new-build',
      providerImageId: 'new-family',
    })
    mockGetBuildStatus.mockResolvedValueOnce({ status: 'ready' })

    await runSandboxImageBuild({
      provider: 'e2b',
      specHash: 'hash-1',
      materialization: oldMaterialization,
    })

    expect(advancedSet).toMatchObject({
      materializationGeneration: CURRENT_MATERIALIZATION.generation,
    })
    expect(predicateText(advancedPredicate)).toContain(String(oldMaterialization.generation))
    expect(mockRunDetached).not.toHaveBeenCalled()
    expect(mockStartBuild).toHaveBeenCalledWith(SPEC, 'hash-1', mockMaterialization.current)
  })

  it('uses the exact claim timestamp and generation for a successful terminal CAS', async () => {
    let claimedAt: Date | undefined
    let terminalPredicate: unknown
    mockUpdate
      .mockReturnValueOnce({
        set: (values: { updatedAt: Date }) => {
          claimedAt = values.updatedAt
          return {
            where: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    spec: SPEC,
                    imageRef: null,
                    buildId: null,
                    providerImageId: null,
                    errorCode: null,
                  },
                ]),
            }),
          }
        },
      })
      .mockReturnValueOnce({
        set: () => ({
          where: (predicate: unknown) => {
            terminalPredicate = predicate
            return { returning: () => Promise.resolve([{ id: 'image-1' }]) }
          },
        }),
      })
    mockStartBuild.mockResolvedValueOnce({
      imageRef: 'sim-sbx-current:new-build',
      buildId: 'new-build',
      providerImageId: 'new-family',
    })
    mockGetBuildStatus.mockResolvedValueOnce({ status: 'ready' })

    await runSandboxImageBuild(
      { provider: 'e2b', specHash: 'hash-1', materialization: CURRENT_MATERIALIZATION },
      { supersededDeleteGraceMs: 0 }
    )

    expect(claimedAt).toBeInstanceOf(Date)
    expect(containsReference(terminalPredicate, claimedAt)).toBe(true)
    expect(predicateText(terminalPredicate)).toContain(String(CURRENT_MATERIALIZATION.generation))
    expect(mockStartBuild).toHaveBeenCalledWith(SPEC, 'hash-1', CURRENT_MATERIALIZATION)
  })

  it('preserves fallback provenance and claim ownership when a refresh fails', async () => {
    let claimedAt: Date | undefined
    let failureSet: Record<string, unknown> | undefined
    let terminalPredicate: unknown
    mockUpdate
      .mockReturnValueOnce({
        set: (values: { updatedAt: Date }) => {
          claimedAt = values.updatedAt
          return {
            where: () => ({
              returning: () =>
                Promise.resolve([
                  {
                    spec: SPEC,
                    imageRef: 'sim-sbx-previous:known-good',
                    buildId: 'old-build',
                    providerImageId: 'old-family',
                    errorCode: 'base_release_refresh',
                  },
                ]),
            }),
          }
        },
      })
      .mockReturnValueOnce({
        set: (values: Record<string, unknown>) => {
          failureSet = values
          return {
            where: (predicate: unknown) => {
              terminalPredicate = predicate
              return Promise.resolve()
            },
          }
        },
      })
    mockStartBuild.mockRejectedValueOnce(new Error('base registry unavailable'))

    await runSandboxImageBuild({
      provider: 'e2b',
      specHash: 'hash-1',
      materialization: CURRENT_MATERIALIZATION,
    })

    expect(failureSet).toMatchObject({
      status: 'failed',
      errorCode: 'base_release_refresh',
      errorMessage: expect.stringContaining('base registry unavailable'),
    })
    expect(failureSet).not.toHaveProperty('imageRef')
    expect(containsReference(terminalPredicate, claimedAt)).toBe(true)
    expect(predicateText(terminalPredicate)).toContain(String(CURRENT_MATERIALIZATION.generation))
  })
})

/** Serializes the mocked predicate tree so a clause can be asserted by shape. */
function predicateText(predicate: unknown): string {
  if (predicate == null) return ''
  if (Array.isArray(predicate)) return predicate.map(predicateText).join(' ')
  if (typeof predicate === 'object') return JSON.stringify(predicate)
  return String(predicate)
}

/**
 * True once a build upsert has been issued. Distinguished from the restore path by
 * the conflict clause: a rebuild is `onConflictDoUpdate`, a restore is
 * `onConflictDoNothing`.
 */
function captureUpsert(): () => boolean {
  let seen = false
  mockInsert.mockReturnValue({
    values: () => ({
      onConflictDoUpdate: () => {
        seen = true
        return { returning: () => Promise.resolve([]) }
      },
      onConflictDoNothing: () => Promise.resolve(),
    }),
  })
  return () => seen
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
    let restored: Record<string, unknown> | undefined
    mockInsert.mockReturnValue({
      values: (values: Record<string, unknown>) => {
        restored = values
        return { onConflictDoNothing: () => Promise.resolve() }
      },
    })

    await expect(releaseSandboxImage('hash-1')).resolves.toBeUndefined()

    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(restored).toMatchObject({
      materializationGeneration: READY_IMAGE.materializationGeneration,
      errorCode: READY_IMAGE.errorCode,
      errorMessage: READY_IMAGE.errorMessage,
      errorDetail: READY_IMAGE.errorDetail,
      lastUsedAt: READY_IMAGE.lastUsedAt,
      createdAt: READY_IMAGE.createdAt,
      updatedAt: READY_IMAGE.updatedAt,
    })
  })

  /**
   * The adopter's row is new and healthy-looking, so nothing else would notice the
   * template went out from under it — resolution only repairs a missing or
   * `failed` row, and a `failed` one waits out the cooldown first.
   */
  it('rebuilds a hash re-adopted while the provider delete was in flight', async () => {
    stubClaim([READY_IMAGE])
    mockSelect.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ id: 'img-new' }]) }) }),
    })
    const enqueued = captureUpsert()

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).toHaveBeenCalledTimes(1)
    expect(enqueued()).toBe(true)
  })

  it('does not rebuild when nothing re-adopted the hash', async () => {
    stubClaim([READY_IMAGE])
    mockSelect.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    })
    const enqueued = captureUpsert()

    await releaseSandboxImage('hash-1')

    expect(enqueued()).toBe(false)
  })

  /**
   * Restoring belongs to a refused delete and nothing else. Once the template is
   * gone, putting the row back would recreate a `ready` row pointing at nothing —
   * the one state resolution cannot repair.
   */
  it('does not restore the row when the post-delete rebuild fails', async () => {
    stubClaim([READY_IMAGE])
    mockSelect.mockImplementation(() => {
      throw new Error('registry unreachable')
    })

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).toHaveBeenCalledTimes(1)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  /**
   * A row claiming `ready` against a deleted template is the state resolution
   * cannot repair, so a rebuild that does not take must not leave one behind.
   * Dropping it converts the adopter into the missing-row case, which the next
   * execution fixes on its own.
   */
  it('drops the dead row when the rebuild cannot be scheduled', async () => {
    stubClaim([READY_IMAGE])
    mockSelect.mockImplementation(() => {
      throw new Error('registry unreachable')
    })

    await releaseSandboxImage('hash-1')

    // The claim itself plus the dead-row cleanup.
    expect(mockDelete).toHaveBeenCalledTimes(2)
  })

  it('skips the provider when the claimed row never had an image', async () => {
    stubClaim([{ ...READY_IMAGE, imageRef: null }])

    await releaseSandboxImage('hash-1')

    expect(mockDeleteImage).not.toHaveBeenCalled()
    expect(mockInsert).not.toHaveBeenCalled()
  })
})

/**
 * The sweep reads a batch of candidates and then works through them a chunk of
 * network calls at a time, so minutes can pass between the query and any one
 * delete. Whether a row still qualifies has to be decided by the claim, not by
 * that earlier read.
 */
describe('cleanupSandboxImages', () => {
  const CANDIDATE = { id: 'img-1', specHash: 'hash-1', imageRef: 'sim-sbx-abc' }

  /**
   * Nomination query only — later selects (the re-adoption check) resolve empty, so
   * a candidate is not mistaken for its own adopter.
   */
  function stubCandidates(rows: unknown[]) {
    mockSelect.mockReturnValue({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
    })
    mockSelect.mockReturnValueOnce({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }),
    })
  }

  it('skips a candidate a workspace adopted after the query ran', async () => {
    stubCandidates([CANDIDATE])
    stubClaim([])

    const result = await cleanupSandboxImages(30)

    expect(mockDeleteImage).not.toHaveBeenCalled()
    expect(result).toEqual({ deleted: 0, failed: 0 })
  })

  it('deletes the image for a candidate that still qualifies at claim time', async () => {
    stubCandidates([CANDIDATE])
    stubClaim([READY_IMAGE])

    const result = await cleanupSandboxImages(30)

    expect(mockDeleteImage).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ deleted: 1, failed: 0 })
  })

  it('restores the row and counts a failure when the provider refuses', async () => {
    stubCandidates([CANDIDATE])
    stubClaim([READY_IMAGE])
    mockDeleteImage.mockRejectedValue(new Error('E2B unreachable'))

    const result = await cleanupSandboxImages(30)

    expect(mockInsert).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ deleted: 0, failed: 1 })
  })

  it('keeps the retention cutoff in the claim, not just the candidate query', async () => {
    stubCandidates([CANDIDATE])
    const read = stubClaim([READY_IMAGE])

    await cleanupSandboxImages(30)

    expect(hasTimeBound(read())).toBe(true)
  })
})

/**
 * True when any leaf of the mocked predicate tree is a `Date`, i.e. a time bound.
 * Cutoffs are bound through `sql.param(date, column)`, so the walk descends into
 * the mock's fragment and param objects as well as condition arrays.
 */
function hasTimeBound(predicate: unknown): boolean {
  if (predicate instanceof Date) return true
  if (Array.isArray(predicate)) return predicate.some(hasTimeBound)
  if (predicate && typeof predicate === 'object') return Object.values(predicate).some(hasTimeBound)
  return false
}

/**
 * The repair path fires once per execution, so re-claiming a failed row on sight
 * would let a per-minute schedule enqueue a per-minute build of a package list
 * that will never resolve. A save is a person asking again and must not wait.
 */
describe('ensureSandboxImage failed-build cooldown', () => {
  const SPEC = {
    language: 'python' as const,
    dependencies: ['pandas'],
    cliTools: [],
    systemPackages: [],
  }

  it('treats a system-package-only sandbox as buildable', async () => {
    const enqueued = captureUpsert()

    await ensureSandboxImage(
      { language: 'python', dependencies: [], cliTools: [], systemPackages: ['jq'] },
      'hash-system-only'
    )

    expect(enqueued()).toBe(true)
  })

  it('refreshes an old ready child without clearing its known-good reference', async () => {
    const updatedAt = new Date('2026-08-03T00:00:00.000Z')
    let refreshSet: Record<string, unknown> | undefined
    mockUpdate.mockReturnValueOnce({
      set: (values: Record<string, unknown>) => {
        refreshSet = values
        return {
          where: () => ({ returning: () => Promise.resolve([{ updatedAt }]) }),
        }
      },
    })

    await ensureSandboxImage(SPEC, 'hash-1')

    expect(refreshSet).toMatchObject({
      status: 'pending',
      errorCode: 'base_release_refresh',
      errorMessage: null,
      errorDetail: null,
    })
    expect(refreshSet).not.toHaveProperty('imageRef')
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockRunDetached).toHaveBeenCalledTimes(1)
  })

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

    const [, rebuildBranches] = read() as unknown[]
    const [, failedBranch] = rebuildBranches as unknown[]
    expect(hasTimeBound(failedBranch)).toBe(true)
  })

  it('leaves the failed branch unbounded for a save, so a person retries at once', async () => {
    const read = captureSetWhere()

    await ensureSandboxImage(SPEC, 'hash-1')

    const [, rebuildBranches] = read() as unknown[]
    const [, failedBranch] = rebuildBranches as unknown[]
    expect(hasTimeBound(failedBranch)).toBe(false)
  })

  /**
   * A row that reached `ready` before the delete landed is the permanent case:
   * resolution repairs a missing or `failed` row, never one claiming to be ready,
   * so its dead `imageRef` would survive until someone re-saved the sandbox.
   */
  it('reclaims a ready row when the image is known to be gone', async () => {
    const read = captureSetWhere()

    await ensureSandboxImage(SPEC, 'hash-1', { missingImageRef: 'sim-sbx-missing:build' })

    const rebuildBranches = (read() as unknown[])[2] as unknown[]
    const branch = predicateText(rebuildBranches[1])
    expect(branch).toContain('status')
    // Excludes only in-flight statuses, so `ready` and `failed` both qualify.
    expect(branch).toContain('pending')
    expect(branch).not.toContain('failed')
    expect(predicateText(read())).toContain('sim-sbx-missing:build')
    expect(predicateText(read())).toContain(String(CURRENT_MATERIALIZATION.generation))
  })

  it('reclaims a ready row whose materialization ref is null', async () => {
    const read = captureSetWhere()

    await ensureSandboxImage(SPEC, 'hash-1')

    const rebuildBranches = (read() as unknown[])[1] as unknown[]
    const branch = predicateText(rebuildBranches[0])
    expect(branch).toContain('ready')
    expect(branch).toContain('is null')
    expect(branch).toContain('image_ref')
  })
})

/**
 * The claim already collapses concurrent saves, so the trigger key only has to
 * distinguish attempts. Keyed by spec alone it suppressed the next legitimate one
 * instead — Trigger.dev returns the finished run, the row stays `pending` with no
 * worker, and nothing can re-claim it until it goes stale.
 */
describe('sandboxBuildIdempotencyKey', () => {
  it('differs between two attempts at the same spec', () => {
    const first = sandboxBuildIdempotencyKey('e2b', 'hash-1', new Date(1_000))
    const second = sandboxBuildIdempotencyKey('e2b', 'hash-1', new Date(2_000))

    expect(first).not.toBe(second)
  })

  it('still collapses a duplicate delivery of one attempt', () => {
    const attemptAt = new Date(1_000)

    expect(sandboxBuildIdempotencyKey('e2b', 'hash-1', attemptAt)).toBe(
      sandboxBuildIdempotencyKey('e2b', 'hash-1', attemptAt)
    )
  })

  it('keeps providers apart for the same content address', () => {
    const attemptAt = new Date(1_000)

    expect(sandboxBuildIdempotencyKey('e2b', 'hash-1', attemptAt)).not.toBe(
      sandboxBuildIdempotencyKey('daytona', 'hash-1', attemptAt)
    )
  })
})
