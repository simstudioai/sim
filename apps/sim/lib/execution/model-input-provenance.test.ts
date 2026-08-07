/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createModelInputProvenanceRequestMetadata,
  inspectModelInputProvenanceRequest,
  PRIVATE_MODEL_INPUT_PROVENANCE_HEADER,
  validateOpaqueModelInputProvenance,
} from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import {
  EMPTY_NON_SECRET_NAMES,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

const ENTRY = {
  name: 'TOKEN',
  plaintext: 'resolved-token',
  encryptedValue: 'encrypted-token',
}

describe('model input provenance transport', () => {
  it('exports only committed provenance present in the selected model input', () => {
    const registry = new ResolvedSecretTraceRegistry([ENTRY], undefined, EMPTY_NON_SECRET_NAMES)
    registry.recordResolved(ENTRY.name, ENTRY.plaintext)

    const metadata = createModelInputProvenanceRequestMetadata(registry, {
      prompt: ENTRY.plaintext,
    })

    expect(metadata).toEqual({
      provenance: {
        version: 1,
        complete: true,
        entries: [{ encryptedValue: ENTRY.encryptedValue, name: ENTRY.name }],
      },
      headerName: PRIVATE_MODEL_INPUT_PROVENANCE_HEADER,
      headerValue: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
      fieldName: RESOLVED_SECRET_PROVENANCE_FIELD,
    })
  })

  it('preserves provenance through a JSON-encoded model-input field', () => {
    const secret = 'quote" slash\\ newline\n'
    const registry = new ResolvedSecretTraceRegistry(
      [{ name: 'TOKEN', plaintext: secret, encryptedValue: 'encrypted-token' }],
      undefined,
      EMPTY_NON_SECRET_NAMES
    )
    registry.recordResolved('TOKEN', secret)

    const metadata = createModelInputProvenanceRequestMetadata(
      registry,
      JSON.stringify([{ role: 'user', content: secret }])
    )

    expect(metadata?.provenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-token', name: 'TOKEN' }],
    })
  })

  it('distinguishes legacy requests from complete and partial private envelopes', () => {
    const provenance = { version: 1, complete: true, entries: [] }

    expect(inspectModelInputProvenanceRequest(new Headers(), {})).toEqual({
      status: 'unsupported',
    })
    expect(
      inspectModelInputProvenanceRequest(
        new Headers({
          [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        }),
        { [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance }
      )
    ).toEqual({ status: 'verified', value: provenance })
    expect(
      inspectModelInputProvenanceRequest(new Headers(), {
        [RESOLVED_SECRET_PROVENANCE_FIELD]: provenance,
      })
    ).toEqual({ status: 'invalid' })
    expect(
      inspectModelInputProvenanceRequest(
        new Headers({
          [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        }),
        {}
      )
    ).toEqual({ status: 'invalid' })
  })

  it('preserves external opaque inputs and requires internal callers to send an envelope', () => {
    expect(
      validateOpaqueModelInputProvenance({
        headers: new Headers(),
        payload: {},
        isInternalRequest: false,
      })
    ).toEqual({ success: true })

    expect(
      validateOpaqueModelInputProvenance({
        headers: new Headers(),
        payload: {},
        isInternalRequest: true,
      })
    ).toEqual({
      success: false,
      error: 'Model input provenance is unavailable',
      status: 400,
    })

    expect(
      validateOpaqueModelInputProvenance({
        headers: new Headers({
          [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        }),
        payload: {
          [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
        },
        isInternalRequest: true,
      })
    ).toEqual({ success: true })
  })

  it('allows only explicitly opted-in internal legacy requests without an envelope', () => {
    expect(
      validateOpaqueModelInputProvenance({
        headers: new Headers(),
        payload: {},
        isInternalRequest: true,
        allowLegacyWithoutEnvelope: true,
      })
    ).toEqual({ success: true })

    expect(
      validateOpaqueModelInputProvenance({
        headers: new Headers(),
        payload: {
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: true,
            entries: [],
          },
        },
        isInternalRequest: true,
        allowLegacyWithoutEnvelope: true,
      })
    ).toEqual({ success: false, error: 'Invalid model input provenance', status: 400 })
  })

  it('fails closed for forged, incomplete, or secret-bearing opaque model input', () => {
    const headers = new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    })

    expect(
      validateOpaqueModelInputProvenance({
        headers,
        payload: {
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: true,
            entries: [{ name: ENTRY.name, encryptedValue: ENTRY.encryptedValue }],
          },
        },
        isInternalRequest: true,
      })
    ).toEqual({
      success: false,
      error: 'Model input contains a resolved secret that cannot be safely projected',
      status: 400,
    })

    expect(
      validateOpaqueModelInputProvenance({
        headers,
        payload: {
          [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: false, entries: [] },
        },
        isInternalRequest: true,
      })
    ).toEqual({
      success: false,
      error: 'Model input provenance is unavailable',
      status: 400,
    })

    expect(
      validateOpaqueModelInputProvenance({
        headers,
        payload: {
          [RESOLVED_SECRET_PROVENANCE_FIELD]: { version: 1, complete: true, entries: [] },
        },
        isInternalRequest: false,
      })
    ).toEqual({ success: false, error: 'Invalid model input provenance', status: 400 })
  })
})
