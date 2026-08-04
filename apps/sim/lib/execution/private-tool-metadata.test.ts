/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  getPrivateToolMetadataField,
  isPrivateToolMetadataType,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_NAMES_FIELD,
  RESOLVED_SECRET_NAMES_METADATA_V1,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  requestsPrivateToolMetadata,
  responseHasPrivateToolMetadata,
} from '@/lib/execution/private-tool-metadata'

describe('private tool metadata protocol', () => {
  it('keeps the versioned wire markers stable', () => {
    expect(PRIVATE_TOOL_METADATA_REQUEST_HEADER).toBe('x-sim-request-private-tool-metadata')
    expect(PRIVATE_TOOL_METADATA_RESPONSE_HEADER).toBe('x-sim-private-tool-metadata')
    expect(RESOLVED_SECRET_NAMES_METADATA_V1).toBe('resolved-secret-names-v1')
    expect(RESOLVED_SECRET_PROVENANCE_METADATA_V1).toBe('resolved-secret-provenance-v1')
    expect(RESOLVED_SECRET_NAMES_FIELD).toBe('__resolvedSecretNames')
    expect(RESOLVED_SECRET_PROVENANCE_FIELD).toBe('__resolvedSecretTraceProvenance')
  })

  it('accepts only exact request and response markers', () => {
    const requestHeaders = new Headers({
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    const responseHeaders = new Headers({
      [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_NAMES_METADATA_V1,
    })

    expect(
      requestsPrivateToolMetadata(requestHeaders, RESOLVED_SECRET_PROVENANCE_METADATA_V1)
    ).toBe(true)
    expect(requestsPrivateToolMetadata(requestHeaders, RESOLVED_SECRET_NAMES_METADATA_V1)).toBe(
      false
    )
    expect(responseHasPrivateToolMetadata(responseHeaders, RESOLVED_SECRET_NAMES_METADATA_V1)).toBe(
      true
    )
    expect(
      responseHasPrivateToolMetadata(responseHeaders, RESOLVED_SECRET_PROVENANCE_METADATA_V1)
    ).toBe(false)
  })

  it('maps each marker to its private payload field', () => {
    expect(isPrivateToolMetadataType(RESOLVED_SECRET_NAMES_METADATA_V1)).toBe(true)
    expect(isPrivateToolMetadataType(RESOLVED_SECRET_PROVENANCE_METADATA_V1)).toBe(true)
    expect(isPrivateToolMetadataType('resolved-secret-provenance-v2')).toBe(false)
    expect(isPrivateToolMetadataType(null)).toBe(false)
    expect(getPrivateToolMetadataField(RESOLVED_SECRET_NAMES_METADATA_V1)).toBe(
      RESOLVED_SECRET_NAMES_FIELD
    )
    expect(getPrivateToolMetadataField(RESOLVED_SECRET_PROVENANCE_METADATA_V1)).toBe(
      RESOLVED_SECRET_PROVENANCE_FIELD
    )
  })
})
