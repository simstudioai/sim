import { createMockRequest } from '@sim/testing'
import { describe, expect, it } from 'vitest'
import {
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { TableRowProvenanceError } from '@/lib/table/application/row-secret-provenance'
import {
  negotiateTableRowsProvenance,
  readTableRowProvenanceEnvelope,
} from '@/app/api/table/row-secret-provenance'

describe('readTableRowProvenanceEnvelope', () => {
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
  it('rejects a session caller that asks for the internal capability', () => {
    const request = createMockRequest('GET', undefined, {
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    expect(() => negotiateTableRowsProvenance(request, false)).toThrow(TableRowProvenanceError)
  })
})
