/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createModelInputProvenanceRequestMetadata,
  inspectModelInputProvenanceRequest,
  PRIVATE_MODEL_INPUT_PROVENANCE_HEADER,
} from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const ENTRY = {
  name: 'TOKEN',
  plaintext: 'resolved-token',
  encryptedValue: 'encrypted-token',
}

describe('model input provenance transport', () => {
  it('exports only committed provenance present in the selected model input', () => {
    const registry = new ResolvedSecretTraceRegistry([ENTRY])
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
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'encrypted-token' },
    ])
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
})
