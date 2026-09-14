/**
 * @vitest-environment node
 */
import { createMockRequest } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { TableRowProvenanceError } from '@/lib/table/application/row-secret-provenance'
import { tableRowSecretProvenanceSelectionKey } from '@/lib/table/secret-provenance-selection'
import {
  finalizeTableRowsProvenance,
  negotiateTableRowsProvenance,
  readTableRowProvenanceEnvelope,
} from '@/app/api/table/row-secret-provenance'

const USER_ID = 'user-1'
const WORKSPACE_ID = 'ws-1'

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
