/**
 * @vitest-environment node
 *
 * The provenance envelope moved out of the route adapter and into the domain,
 * because interpreting a caller's selections requires the canonical schema and
 * the adapter must not load it. These pin the semantics that move with it.
 */
import { describe, expect, it, vi } from 'vitest'

const { mocks } = vi.hoisted(() => ({
  mocks: { scopeCompatible: vi.fn(() => true) },
}))

vi.mock('@/lib/execution/durable-secret-provenance', () => ({
  isPrivateSecretProvenanceScopeCompatible: mocks.scopeCompatible,
}))

import {
  resolveRowWriteProvenance,
  TableRowProvenanceError,
} from '@/lib/table/application/row-secret-provenance'
import type { TableDefinition } from '@/lib/table/types'

const TABLE = {
  id: 'tbl_1',
  workspaceId: 'workspace-1',
  schema: {
    columns: [
      { id: 'col_aaa', name: 'Name', type: 'string' },
      { id: 'col_bbb', name: 'Age', type: 'number' },
    ],
  },
} as unknown as TableDefinition

const SESSION = { kind: 'session' as const, userId: 'user-1', sessionId: 'session-1' }
const EXECUTOR = {
  kind: 'delegated' as const,
  serviceId: 'executor' as const,
  workspaceId: 'workspace-1',
  delegationId: 'delegation-1',
  audience: 'table',
  issuedAt: new Date('2026-01-01'),
  expiresAt: new Date('2099-01-02'),
  delegationContext: {
    kind: 'workflow_execution' as const,
    workflowId: 'workflow-1',
    currentWorkflow: {
      workflowId: 'workflow-1',
      mode: 'deployment' as const,
      deploymentVersionId: 'deployment-1',
    },
    principal: {
      kind: 'system' as const,
      serviceId: 'webhook' as const,
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      webhookId: 'webhook-1',
      provider: 'generic',
    },
  },
}

/**
 * A provenance shape the real `isResolvedSecretTraceProvenanceV1` accepts.
 *
 * These fixtures run against the genuine envelope guard rather than a stub, so a
 * bundle that could never survive the wire cannot pass here either.
 */
function traceProvenance(scope?: { userId: string; workspaceId: string }) {
  return { version: 1 as const, complete: true, entries: [], ...(scope ? { scope } : {}) }
}

/** A bundle shape the real `isPrivateSecretProvenanceBundleV1` accepts. */
function bundle(
  selections: Array<{ key: string; scope?: { userId: string; workspaceId: string } }>,
  complete = true
) {
  return {
    version: 1 as const,
    complete,
    selections: selections.map((selection) => ({
      key: selection.key,
      provenance: traceProvenance(selection.scope),
    })),
  }
}

function resolve(overrides: Partial<Parameters<typeof resolveRowWriteProvenance>[0]>) {
  return resolveRowWriteProvenance({
    envelope: { kind: 'none' },
    principal: SESSION,
    workspaceId: 'workspace-1',
    table: TABLE,
    keying: 'ids',
    wireRows: [{ col_aaa: 'Ada' }],
    storageRows: [{ col_aaa: 'Ada' }],
    ...overrides,
  })
}

describe('row write provenance', () => {
  it('certifies an interactive write exact-empty over the columns it persists', () => {
    const { stamps } = resolve({})

    expect(stamps).toEqual([
      { complete: true, columns: { col_aaa: { version: 1, complete: true, entries: [] } } },
    ])
  })

  it('leaves an internal caller that sent no envelope untracked', () => {
    // Not exact-empty: stamping "this write introduced no secrets" on a runtime
    // write that sent no envelope would be a false certification.
    const { stamps } = resolve({ principal: EXECUTOR })

    expect(stamps).toEqual([undefined])
  })

  it('refuses a bundle from a session caller', () => {
    expect(() => resolve({ envelope: { kind: 'bundle', value: bundle([]) } })).toThrow(
      TableRowProvenanceError
    )
  })

  it('refuses a bundle that is not a recognised envelope', () => {
    expect(() =>
      resolve({ principal: EXECUTOR, envelope: { kind: 'bundle', value: { nope: true } } })
    ).toThrow(TableRowProvenanceError)
  })

  it('refuses a bundle whose selections carry an unrecognised provenance shape', () => {
    expect(() =>
      resolve({
        principal: EXECUTOR,
        envelope: {
          kind: 'bundle',
          value: {
            version: 1,
            complete: true,
            selections: [
              { key: JSON.stringify([0, 'col_aaa']), provenance: { scope: { kind: 'workspace' } } },
            ],
          },
        },
      })
    ).toThrow(TableRowProvenanceError)
  })

  it('refuses a complete bundle that does not account for every written cell', () => {
    expect(() =>
      resolve({
        principal: EXECUTOR,
        envelope: { kind: 'bundle', value: bundle([]) },
        wireRows: [{ col_aaa: 'Ada', col_bbb: 36 }],
        storageRows: [{ col_aaa: 'Ada', col_bbb: 36 }],
      })
    ).toThrow(TableRowProvenanceError)
  })

  it('refuses a selection whose scope this principal may not read', () => {
    mocks.scopeCompatible.mockReturnValueOnce(false)

    expect(() =>
      resolve({
        principal: EXECUTOR,
        envelope: {
          kind: 'bundle',
          value: bundle([{ key: JSON.stringify([0, 'col_aaa']) }]),
        },
      })
    ).toThrow(TableRowProvenanceError)
  })

  it('marks an incomplete bundle unknown rather than certifying it', () => {
    const { stamps } = resolve({
      principal: EXECUTOR,
      envelope: { kind: 'bundle', value: bundle([], false) },
    })

    expect(stamps).toEqual([{ complete: false, columns: {} }])
  })

  it('keys a name-wire selection to the storage column it certifies', () => {
    const { stamps } = resolve({
      principal: EXECUTOR,
      keying: 'names',
      wireRows: [{ Name: 'Ada' }],
      storageRows: [{ col_aaa: 'Ada' }],
      envelope: { kind: 'bundle', value: bundle([{ key: JSON.stringify([0, 'Name']) }]) },
    })

    expect(stamps[0]).toEqual({ complete: true, columns: { col_aaa: traceProvenance() } })
  })

  it('checks a deployed actorless execution against its authorized workspace', () => {
    resolve({
      principal: EXECUTOR,
      envelope: {
        kind: 'bundle',
        value: bundle([
          {
            key: JSON.stringify([0, 'col_aaa']),
            scope: { userId: 'billing-owner', workspaceId: 'workspace-1' },
          },
        ]),
      },
    })

    expect(mocks.scopeCompatible).toHaveBeenCalledWith(
      { userId: 'billing-owner', workspaceId: 'workspace-1' },
      { workspaceId: 'workspace-1' }
    )
  })

  it('records provenance for an id-keyed key the write persists, recognised or not', () => {
    // The id wire stores what it is given, so every key it sends is a storage
    // key. Mapping an unrecognised one to null would leave a written cell
    // uncertified under a complete stamp.
    const { stamps } = resolve({
      principal: EXECUTOR,
      keying: 'ids',
      wireRows: [{ 'col-unknown': 'x' }],
      storageRows: [{ 'col-unknown': 'x' }],
      envelope: { kind: 'bundle', value: bundle([{ key: JSON.stringify([0, 'col-unknown']) }]) },
    })

    expect(stamps[0]).toEqual({ complete: true, columns: { 'col-unknown': traceProvenance() } })
  })

  it('records nothing for a key that names no column, since it is never stored', () => {
    const { stamps } = resolve({
      principal: EXECUTOR,
      keying: 'names',
      wireRows: [{ Nope: 'x' }],
      storageRows: [{}],
      envelope: { kind: 'bundle', value: bundle([{ key: JSON.stringify([0, 'Nope']) }]) },
    })

    expect(stamps[0]).toEqual({ complete: true, columns: {} })
  })
})
