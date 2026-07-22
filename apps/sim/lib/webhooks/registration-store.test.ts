/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface Condition {
  kind: string
  column?: unknown
  value?: unknown
  conditions?: Condition[]
}

const { mockTransaction, mockIsDeploymentOperationCurrent, mockClaimWebhookPath } = vi.hoisted(
  () => ({
    mockTransaction: vi.fn(),
    mockIsDeploymentOperationCurrent: vi.fn(),
    mockClaimWebhookPath: vi.fn(),
  })
)

vi.mock('@sim/db', () => ({
  db: { transaction: mockTransaction },
}))

vi.mock('drizzle-orm', () => ({
  and: (...conditions: Condition[]) => ({ kind: 'and', conditions }),
  eq: (column: unknown, value: unknown) => ({ kind: 'eq', column, value }),
  exists: (subquery: unknown) => ({ kind: 'exists', subquery }),
  gt: (column: unknown, value: unknown) => ({ kind: 'gt', column, value }),
  inArray: (column: unknown, value: unknown) => ({ kind: 'inArray', column, value }),
  isNull: (column: unknown) => ({ kind: 'isNull', column }),
  lt: (column: unknown, value: unknown) => ({ kind: 'lt', column, value }),
  lte: (column: unknown, value: unknown) => ({ kind: 'lte', column, value }),
  notExists: (subquery: unknown) => ({ kind: 'notExists', subquery }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    kind: 'sql',
    strings: [...strings],
    values,
  }),
}))

vi.mock('@/lib/webhooks/provider-subscriptions', () => ({
  projectDesiredWebhookProviderConfig: (config: Record<string, unknown>) => config,
}))

vi.mock('@/lib/webhooks/path-claims', () => ({
  claimWebhookPath: mockClaimWebhookPath,
}))

vi.mock('@/lib/workflows/persistence/deployment-operations', () => ({
  isDeploymentOperationCurrent: mockIsDeploymentOperationCurrent,
  setDeploymentTxTimeouts: vi.fn(),
}))

import type { DbOrTx } from '@sim/workflow-persistence/types'
import {
  activateWebhookRegistrations,
  prepareWebhookRegistrationIntents,
  StaleWebhookRegistrationOperationError,
  type WebhookRegistrationOperationFence,
} from '@/lib/webhooks/registration-store'

const FENCE: WebhookRegistrationOperationFence = {
  workflowId: 'workflow-1',
  operationId: 'operation-1',
  generation: 3,
  deploymentVersionId: 'version-3',
}

interface UpdateCall {
  payload: Record<string, unknown>
  condition: Condition
}

interface InsertCall {
  values: Record<string, unknown>
}

/**
 * Queue-driven transaction mock: every select drains the next result from the
 * queue regardless of terminal call shape (`for`, `limit`, direct await), and
 * updates/inserts capture their payloads for assertions.
 */
function createTx(selectResults: unknown[][]) {
  const updates: UpdateCall[] = []
  const inserts: InsertCall[] = []
  const updateResults: unknown[][] = []

  const nextSelect = () => {
    const result = selectResults.shift()
    if (!result) throw new Error('Unexpected select: result queue is empty')
    return result
  }

  const tx = {
    select: vi.fn(() => ({
      from: vi.fn(() => {
        const terminal = (result: unknown[]) => ({
          for: vi.fn(async () => result),
          limit: vi.fn(async () => result),
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => result) })),
          then: (resolve: (rows: unknown[]) => void) => resolve(result),
        })
        return {
          where: vi.fn(() => terminal(nextSelect())),
        }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => ({
        where: vi.fn((condition: Condition) => {
          updates.push({ payload, condition })
          const result = updateResults.shift() ?? [{ id: 'updated' }]
          return {
            returning: vi.fn(async () => result),
            then: (resolve: (rows: unknown[]) => void) => resolve(result),
          }
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        inserts.push({ values })
        return { returning: vi.fn(async () => [{ ...values }]) }
      }),
    })),
  }

  return { tx: tx as unknown as DbOrTx, updates, inserts, updateResults }
}

function activeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'wh-active',
    workflowId: 'workflow-1',
    blockId: 'block-1',
    provider: 'slack',
    path: 'hooks/a',
    routingKey: null,
    providerConfig: {},
    registrationStatus: 'active',
    registrationGeneration: 2,
    configFingerprint: 'fp-old',
    preparedAt: new Date('2026-07-01T00:00:00Z'),
    isActive: true,
    archivedAt: null,
    deploymentVersionId: 'version-2',
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    createdAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  }
}

describe('activateWebhookRegistrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDeploymentOperationCurrent.mockResolvedValue(true)
  })

  it('rejects when candidates are not fully prepared', async () => {
    const { tx, updates } = createTx([[{ id: 'workflow-1' }], [{ id: 'wh-unprepared' }]])

    await expect(activateWebhookRegistrations(tx, FENCE)).rejects.toThrow(
      'Webhook registration candidates are not fully prepared'
    )
    expect(updates).toHaveLength(0)
  })

  it('rejects stale operations when newer generation rows exist', async () => {
    const { tx, updates } = createTx([[{ id: 'workflow-1' }], [], [{ id: 'wh-newer' }]])

    await expect(activateWebhookRegistrations(tx, FENCE)).rejects.toBeInstanceOf(
      StaleWebhookRegistrationOperationError
    )
    expect(updates).toHaveLength(0)
  })

  it('rejects when the operation is no longer current', async () => {
    mockIsDeploymentOperationCurrent.mockResolvedValue(false)
    const { tx, updates } = createTx([[{ id: 'workflow-1' }]])

    await expect(activateWebhookRegistrations(tx, FENCE)).rejects.toBeInstanceOf(
      StaleWebhookRegistrationOperationError
    )
    expect(updates).toHaveLength(0)
  })

  it('retires older actives, repoints reused rows, and promotes candidates atomically', async () => {
    const { tx, updates } = createTx([[{ id: 'workflow-1' }], [], []])

    await activateWebhookRegistrations(tx, FENCE)

    expect(updates).toHaveLength(2)
    /**
     * Retire + repoint fold into one generation-conditional statement over
     * the active rows: every mutated column is a CASE keyed on the fence
     * generation, and the WHERE covers both phases via lte.
     */
    expect(updates[0].payload.registrationStatus).toEqual(expect.objectContaining({ kind: 'sql' }))
    expect(updates[0].payload.deploymentVersionId).toEqual(
      expect.objectContaining({ kind: 'sql', values: expect.arrayContaining(['version-3']) })
    )
    expect(updates[0].payload.isActive).toEqual(expect.objectContaining({ kind: 'sql' }))
    expect(updates[0].payload.archivedAt).toEqual(expect.objectContaining({ kind: 'sql' }))
    expect(updates[0].payload.updatedAt).toBeInstanceOf(Date)
    expect(JSON.stringify(updates[0].condition)).toContain('"lte"')

    expect(updates[1].payload).toEqual(
      expect.objectContaining({
        registrationStatus: 'active',
        deploymentVersionId: 'version-3',
        isActive: true,
        archivedAt: null,
      })
    )
  })
})

describe('prepareWebhookRegistrationIntents', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsDeploymentOperationCurrent.mockResolvedValue(true)
    mockClaimWebhookPath.mockResolvedValue('hooks/a')
    mockTransaction.mockImplementation(async (callback: (tx: DbOrTx) => Promise<unknown>) => {
      throw new Error('mockTransaction not configured for this test')
    })
  })

  function runInTx(selectResults: unknown[][]) {
    const harness = createTx(selectResults)
    mockTransaction.mockImplementation(async (callback: (tx: DbOrTx) => Promise<unknown>) =>
      callback(harness.tx)
    )
    return harness
  }

  const desired = {
    blockId: 'block-1',
    provider: 'slack',
    path: 'hooks/a',
    routingKey: null,
    providerConfig: { url: 'https://example.test' },
    configFingerprint: 'fp-new',
  }

  it('claims paths and writes legacy-invisible candidates for changed registrations', async () => {
    const previousActive = activeRow()
    const { inserts, updates } = runInTx([[{ id: 'workflow-1' }], [], [previousActive], [], []])

    const work = await prepareWebhookRegistrationIntents({ fence: FENCE, desired: [desired] })

    expect(mockClaimWebhookPath).toHaveBeenCalledWith(expect.anything(), {
      path: 'hooks/a',
      workflowId: 'workflow-1',
      generation: 3,
    })
    expect(updates).toHaveLength(0)
    expect(inserts).toHaveLength(1)
    expect(inserts[0].values).toEqual(
      expect.objectContaining({
        registrationStatus: 'candidate',
        registrationGeneration: 3,
        configFingerprint: 'fp-new',
        isActive: false,
        preparedAt: null,
        deploymentVersionId: 'version-3',
      })
    )
    expect(inserts[0].values.archivedAt).toBeInstanceOf(Date)
    expect(work.candidates).toHaveLength(1)
    expect(work.candidates[0].row.blockId).toBe('block-1')
  })

  it('reuses fingerprint-matched active rows by bumping their generation fence', async () => {
    const reusable = activeRow({ configFingerprint: 'fp-new' })
    const { inserts, updates } = runInTx([[{ id: 'workflow-1' }], [], [reusable], [], []])

    const work = await prepareWebhookRegistrationIntents({ fence: FENCE, desired: [desired] })

    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual(
      expect.objectContaining({ registrationGeneration: 3, configFingerprint: 'fp-new' })
    )
    expect(work.candidates).toHaveLength(0)
  })

  it('adopts a fingerprint-identical candidate from a superseded attempt instead of reinserting', async () => {
    const supersededCandidate = activeRow({
      id: 'wh-prev-candidate',
      registrationStatus: 'candidate',
      registrationGeneration: 2,
      configFingerprint: 'fp-new',
      preparedAt: null,
      isActive: false,
      deploymentVersionId: 'version-2',
      archivedAt: new Date('2026-07-14T00:00:00Z'),
    })
    const { inserts, updates } = runInTx([
      [{ id: 'workflow-1' }],
      [],
      [],
      [supersededCandidate],
      [],
    ])

    const work = await prepareWebhookRegistrationIntents({ fence: FENCE, desired: [desired] })

    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual(
      expect.objectContaining({ registrationGeneration: 3, deploymentVersionId: 'version-3' })
    )
    expect(work.candidates).toHaveLength(1)
    expect(work.orphanedCandidates).toHaveLength(0)
  })

  it('re-collects stale orphans from earlier attempts so they cannot leak forever', async () => {
    const staleOrphan = activeRow({
      id: 'wh-stale-orphan',
      registrationStatus: 'orphaned',
      registrationGeneration: 2,
      preparedAt: null,
      isActive: false,
      archivedAt: new Date('2026-07-13T00:00:00Z'),
    })
    const { inserts } = runInTx([[{ id: 'workflow-1' }], [], [], [], [staleOrphan]])

    const work = await prepareWebhookRegistrationIntents({ fence: FENCE, desired: [desired] })

    expect(work.orphanedCandidates).toEqual([staleOrphan])
    expect(inserts).toHaveLength(1)
  })

  it('rejects stale generations before touching rows', async () => {
    mockIsDeploymentOperationCurrent.mockResolvedValue(false)
    const { inserts, updates } = runInTx([[{ id: 'workflow-1' }]])

    await expect(
      prepareWebhookRegistrationIntents({ fence: FENCE, desired: [desired] })
    ).rejects.toBeInstanceOf(StaleWebhookRegistrationOperationError)
    expect(inserts).toHaveLength(0)
    expect(updates).toHaveLength(0)
  })
})
