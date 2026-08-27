/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import { AuthType } from '@/lib/auth/hybrid'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { TableRowProvenanceError } from '@/lib/table/application/row-secret-provenance'
import { rowDataNameToId } from '@/lib/table/column-keys'
import { tableRowSecretProvenanceSelectionKey } from '@/lib/table/secret-provenance-selection'
import type { RowData } from '@/lib/table/types'
import {
  createTableWriteProvenanceTargets,
  finalizeTableRowsProvenance,
  negotiateTableRowsProvenance,
  readTableRowProvenanceEnvelope,
  resolveTableWriteSecretProvenance,
} from '@/app/api/table/row-secret-provenance'

const USER_ID = 'user-1'
const WORKSPACE_ID = 'ws-1'

/** Mirrors the internal-JWT wire translator: names → ids, unknown names dropped. */
const ID_BY_NAME = new Map([
  ['email', 'col_email'],
  ['company', 'col_company'],
])

const translateNames = (data: RowData): RowData => rowDataNameToId(data, ID_BY_NAME)
const translateIdentity = (data: RowData): RowData => data

function traceProvenance() {
  return {
    version: 1,
    complete: true,
    entries: [],
    scope: { userId: USER_ID, workspaceId: WORKSPACE_ID },
  }
}

function bundleRequest(selectionKeys: string[]) {
  const payload = {
    [PRIVATE_SECRET_PROVENANCE_FIELD]: {
      version: 1,
      complete: true,
      selections: selectionKeys.map((key) => ({ key, provenance: traceProvenance() })),
    },
  }
  const request = createMockRequest('POST', payload, {
    [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  })
  return { request, payload }
}

describe('createTableWriteProvenanceTargets', () => {
  it('maps column names to their storage ids', () => {
    const targets = createTableWriteProvenanceTargets([{ email: 'a@b.c' }], translateNames)

    expect(targets).toEqual([
      {
        selectionKey: tableRowSecretProvenanceSelectionKey(0, 'email'),
        rowKey: '0',
        columnId: 'col_email',
      },
    ])
  })

  it('returns a null column id for a column the wire translator drops', () => {
    const targets = createTableWriteProvenanceTargets(
      [{ email: 'a@b.c', notAColumn: 'x' }],
      translateNames
    )

    expect(targets).toHaveLength(2)
    expect(targets[0].columnId).toBe('col_email')
    expect(targets[1]).toEqual({
      selectionKey: tableRowSecretProvenanceSelectionKey(0, 'notAColumn'),
      rowKey: '0',
      columnId: null,
    })
  })

  it('keeps one target per submitted column so bundle selections stay paired', () => {
    const targets = createTableWriteProvenanceTargets(
      [{ notAColumn: 'x', alsoNotAColumn: 'y' }],
      translateNames
    )

    expect(targets.map((target) => target.columnId)).toEqual([null, null])
  })

  it('passes column ids through for identity (session) translation', () => {
    const targets = createTableWriteProvenanceTargets([{ col_email: 'a@b.c' }], translateIdentity)

    expect(targets[0].columnId).toBe('col_email')
  })

  it('keys targets by row index across multiple rows', () => {
    const targets = createTableWriteProvenanceTargets(
      [{ email: 'a@b.c' }, { company: 'Acme' }],
      translateNames
    )

    expect(targets.map((target) => target.rowKey)).toEqual(['0', '1'])
    expect(targets[1].selectionKey).toBe(tableRowSecretProvenanceSelectionKey(1, 'company'))
  })
})

describe('resolveTableWriteSecretProvenance', () => {
  it('records no provenance for a dropped column on an unsupported session write', () => {
    const rows = [{ email: 'a@b.c', notAColumn: 'x' }]
    const result = resolveTableWriteSecretProvenance({
      request: createMockRequest('POST', { rows }),
      payload: { rows },
      authType: AuthType.SESSION,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      targets: createTableWriteProvenanceTargets(rows, translateNames),
      rowKeys: ['0'],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(Object.keys(result.provenanceByRowKey?.['0'].columns ?? {})).toEqual(['col_email'])
  })

  it('accepts a complete bundle that covers a dropped column', () => {
    const rows = [{ email: 'a@b.c', notAColumn: 'x' }]
    const { request, payload } = bundleRequest([
      tableRowSecretProvenanceSelectionKey(0, 'email'),
      tableRowSecretProvenanceSelectionKey(0, 'notAColumn'),
    ])

    const result = resolveTableWriteSecretProvenance({
      request,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      targets: createTableWriteProvenanceTargets(rows, translateNames),
      rowKeys: ['0'],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(Object.keys(result.provenanceByRowKey?.['0'].columns ?? {})).toEqual(['col_email'])
  })

  it('stores provenance for a fully translatable bundle', () => {
    const rows = [{ email: 'a@b.c', company: 'Acme' }]
    const { request, payload } = bundleRequest([
      tableRowSecretProvenanceSelectionKey(0, 'email'),
      tableRowSecretProvenanceSelectionKey(0, 'company'),
    ])

    const result = resolveTableWriteSecretProvenance({
      request,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      targets: createTableWriteProvenanceTargets(rows, translateNames),
      rowKeys: ['0'],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(Object.keys(result.provenanceByRowKey?.['0'].columns ?? {}).sort()).toEqual([
      'col_company',
      'col_email',
    ])
  })

  it('rejects a bundle whose selection matches no submitted column', () => {
    const rows = [{ email: 'a@b.c' }]
    const { request, payload } = bundleRequest([tableRowSecretProvenanceSelectionKey(0, 'company')])

    const result = resolveTableWriteSecretProvenance({
      request,
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      targets: createTableWriteProvenanceTargets(rows, translateNames),
      rowKeys: ['0'],
    })

    expect(result.success).toBe(false)
  })

  it('accepts a different source user in the authorized destination workspace', () => {
    const rows = [{ email: 'a@b.c' }]
    const payload = {
      [PRIVATE_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        selections: [
          {
            key: tableRowSecretProvenanceSelectionKey(0, 'email'),
            provenance: {
              ...traceProvenance(),
              scope: { userId: 'someone-else', workspaceId: WORKSPACE_ID },
            },
          },
        ],
      },
    }

    const result = resolveTableWriteSecretProvenance({
      request: createMockRequest('POST', payload, {
        [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
      }),
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      targets: createTableWriteProvenanceTargets(rows, translateNames),
      rowKeys: ['0'],
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.provenanceByRowKey?.['0'].columns.col_email).toMatchObject({
      scope: { userId: 'someone-else', workspaceId: WORKSPACE_ID },
    })
  })

  it('rejects a bundle whose selection comes from another workspace', () => {
    const rows = [{ email: 'a@b.c' }]
    const payload = {
      [PRIVATE_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        selections: [
          {
            key: tableRowSecretProvenanceSelectionKey(0, 'email'),
            provenance: {
              ...traceProvenance(),
              scope: { userId: USER_ID, workspaceId: 'another-workspace' },
            },
          },
        ],
      },
    }

    const result = resolveTableWriteSecretProvenance({
      request: createMockRequest('POST', payload, {
        [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
      }),
      payload,
      authType: AuthType.INTERNAL_JWT,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      targets: createTableWriteProvenanceTargets(rows, translateNames),
      rowKeys: ['0'],
    })

    expect(result.success).toBe(false)
  })
})

/**
 * The transport half of the envelope, used by the migrated single-row routes.
 *
 * These are the only cover these helpers have: the route tests assert `mapInput`
 * and `present`, so each helper could be replaced by a constant without a route
 * test noticing — and a constant `readTableRowProvenanceEnvelope` would silently
 * downgrade every executor write from a stamped bundle to untracked.
 */
describe('readTableRowProvenanceEnvelope', () => {
  it('reports no envelope when the caller sent none', () => {
    const request = createMockRequest('PATCH', { data: {} })

    expect(readTableRowProvenanceEnvelope(request, { data: {} })).toEqual({ kind: 'none' })
  })

  it('hands the verified bundle over unresolved', () => {
    const { request, payload } = bundleRequest([tableRowSecretProvenanceSelectionKey(0, 'email')])

    const envelope = readTableRowProvenanceEnvelope(request, payload)

    expect(envelope.kind).toBe('bundle')
    expect(envelope).toEqual({ kind: 'bundle', value: payload[PRIVATE_SECRET_PROVENANCE_FIELD] })
  })

  it('rejects a declared bundle whose payload field is missing', () => {
    const request = createMockRequest(
      'PATCH',
      { data: {} },
      { [PRIVATE_SECRET_PROVENANCE_HEADER]: PRIVATE_SECRET_PROVENANCE_BUNDLE_V1 }
    )

    expect(() => readTableRowProvenanceEnvelope(request, { data: {} })).toThrow(
      TableRowProvenanceError
    )
  })
})

describe('negotiateTableRowsProvenance', () => {
  it('is not requested without the capability header', () => {
    expect(negotiateTableRowsProvenance(createMockRequest('GET', undefined), true)).toBe(false)
  })

  it('is accepted for an internal caller that asked for it', () => {
    const request = createMockRequest('GET', undefined, {
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    expect(negotiateTableRowsProvenance(request, true)).toBe(true)
  })

  it('rejects a session caller that asks for the internal capability', () => {
    const request = createMockRequest('GET', undefined, {
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    expect(() => negotiateTableRowsProvenance(request, false)).toThrow(TableRowProvenanceError)
  })
})

describe('finalizeTableRowsProvenance', () => {
  it('adds nothing when the use case loaded no provenance', () => {
    expect(finalizeTableRowsProvenance(undefined)).toEqual({})
  })

  it('adds the sibling body field and the capability header when it did', () => {
    const finalized = finalizeTableRowsProvenance({ rows: [] })

    expect(finalized.bodyFields).toBeDefined()
    expect(new Headers(finalized.headers).get(PRIVATE_TOOL_METADATA_RESPONSE_HEADER)).toBe(
      RESOLVED_SECRET_PROVENANCE_METADATA_V1
    )
  })
})
