/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  inspectPrivateToolMetadataEnvelope,
  inspectPrivateToolMetadataResponseCapability,
  negotiatePrivateToolMetadataResponse,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2,
  RESOLVED_SECRET_NAMES_FIELD,
  RESOLVED_SECRET_NAMES_METADATA_V1,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
  requestsPrivateToolMetadata,
  serializePrivateToolMetadataResponseEnvelope,
} from '@/lib/execution/private-tool-metadata'

describe('private tool metadata protocol', () => {
  it('keeps the versioned wire markers stable', () => {
    expect(PRIVATE_TOOL_METADATA_REQUEST_HEADER).toBe('x-sim-request-private-tool-metadata')
    expect(PRIVATE_TOOL_METADATA_RESPONSE_HEADER).toBe('x-sim-private-tool-metadata')
    expect(RESOLVED_SECRET_NAMES_METADATA_V1).toBe('resolved-secret-names-v1')
    expect(RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2).toBe(
      'resolved-secret-names-durable-files-v2'
    )
    expect(RESOLVED_SECRET_PROVENANCE_METADATA_V1).toBe('resolved-secret-provenance-v1')
    expect(RESOLVED_SECRET_NAMES_FIELD).toBe('__resolvedSecretNames')
    expect(RESOLVED_SECRET_PROVENANCE_FIELD).toBe('__resolvedSecretTraceProvenance')
  })

  it('accepts only exact request markers', () => {
    const requestHeaders = new Headers({
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    expect(
      requestsPrivateToolMetadata(requestHeaders, RESOLVED_SECRET_PROVENANCE_METADATA_V1)
    ).toBe(true)
    expect(requestsPrivateToolMetadata(requestHeaders, RESOLVED_SECRET_NAMES_METADATA_V1)).toBe(
      false
    )
  })

  it('negotiates authenticated private response metadata before serialization', () => {
    const requestedHeaders = new Headers({
      [PRIVATE_TOOL_METADATA_REQUEST_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    expect(
      negotiatePrivateToolMetadataResponse(
        requestedHeaders,
        RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        true
      )
    ).toEqual({ status: 'accepted' })
    expect(
      negotiatePrivateToolMetadataResponse(
        requestedHeaders,
        RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        false
      )
    ).toEqual({ status: 'rejected' })
    expect(
      negotiatePrivateToolMetadataResponse(
        requestedHeaders,
        RESOLVED_SECRET_NAMES_METADATA_V1,
        true
      )
    ).toEqual({ status: 'rejected' })
    expect(
      negotiatePrivateToolMetadataResponse(
        new Headers(),
        RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        true
      )
    ).toEqual({ status: 'not-requested' })
  })

  it('serializes each private metadata type into its exact wire envelope', () => {
    const names = ['API_KEY']
    const provenance = { version: 1, complete: true, entries: [] }

    expect(
      serializePrivateToolMetadataResponseEnvelope(
        { result: 'ok' },
        RESOLVED_SECRET_NAMES_METADATA_V1,
        names
      )
    ).toEqual({
      body: { result: 'ok', [RESOLVED_SECRET_NAMES_FIELD]: names },
      headers: {
        [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_NAMES_METADATA_V1,
      },
    })
    expect(
      serializePrivateToolMetadataResponseEnvelope(
        { result: 'ok' },
        RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2,
        names
      )
    ).toEqual({
      body: { result: 'ok', [RESOLVED_SECRET_NAMES_FIELD]: names },
      headers: {
        [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2,
      },
    })
    expect(
      serializePrivateToolMetadataResponseEnvelope(
        { result: 'ok' },
        RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        provenance
      )
    ).toEqual({
      body: { result: 'ok', [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance },
      headers: {
        [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      },
    })
  })

  it('distinguishes supported, legacy, and mismatched response capabilities', () => {
    expect(
      inspectPrivateToolMetadataResponseCapability(
        new Headers(),
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
    ).toEqual({ status: 'unsupported' })
    expect(
      inspectPrivateToolMetadataResponseCapability(
        new Headers({
          [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        }),
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
    ).toEqual({ status: 'supported' })
    expect(
      inspectPrivateToolMetadataResponseCapability(
        new Headers({
          [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_NAMES_METADATA_V1,
        }),
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
    ).toEqual({
      status: 'mismatched',
      receivedType: RESOLVED_SECRET_NAMES_METADATA_V1,
    })
  })

  it('treats only complete marker-and-field envelopes as verified', () => {
    const supportedHeaders = new Headers({
      [PRIVATE_TOOL_METADATA_RESPONSE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })
    const provenance = { version: 1, complete: true, entries: [] }

    expect(
      inspectPrivateToolMetadataEnvelope(
        supportedHeaders,
        { [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance },
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
    ).toEqual({ status: 'verified', value: provenance })
    expect(
      inspectPrivateToolMetadataEnvelope(
        new Headers(),
        { output: 'legacy' },
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
    ).toEqual({ status: 'unsupported' })
    expect(
      inspectPrivateToolMetadataEnvelope(
        supportedHeaders,
        { output: 'missing field' },
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
    ).toEqual({ status: 'invalid' })
    expect(
      inspectPrivateToolMetadataEnvelope(
        new Headers(),
        { [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance },
        RESOLVED_SECRET_PROVENANCE_METADATA_V1
      )
    ).toEqual({ status: 'invalid' })
  })
})
