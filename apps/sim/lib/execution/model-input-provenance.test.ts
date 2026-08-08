/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  createModelInputProvenanceRequestMetadata,
  inspectModelInputProjectionState,
  inspectModelInputProvenanceRequest,
  PRIVATE_MODEL_INPUT_PROVENANCE_HEADER,
  PRIVATE_MODEL_INPUT_STATE_HEADER,
  PROJECTED_MODEL_INPUT_PATHS_V1,
  projectModelSchemaAnnotations,
  projectResolvedModelInput,
  selectModelSchemaInputPaths,
  validateOpaqueModelInputProvenance,
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
  it('exports only committed provenance recorded at the selected input paths', () => {
    const registry = new ResolvedSecretTraceRegistry([ENTRY])
    registry.recordResolvedAtInputPath(ENTRY.name, ENTRY.plaintext, ['prompt'])

    const metadata = createModelInputProvenanceRequestMetadata(registry, [['prompt']])

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
    registry.recordResolvedAtInputPath('TOKEN', secret, ['messages', '0', 'content'])

    const metadata = createModelInputProvenanceRequestMetadata(registry, [['messages']])

    expect(metadata?.provenance).toEqual({
      version: 1,
      complete: true,
      entries: [{ encryptedValue: 'encrypted-token', name: 'TOKEN' }],
    })
  })

  it('projects only resolver-recorded leaves without matching equal public text', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'x', encryptedValue: 'encrypted-token' },
    ])
    registry.recordResolvedAtInputPath('TOKEN', 'x', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'x', '{{TOKEN}}')

    const projection = projectResolvedModelInput(
      registry,
      { prompt: 'x', publicText: 'Box eSign' },
      [['prompt']]
    )

    expect(projection).toMatchObject({
      complete: true,
      value: { prompt: '{{TOKEN}}', publicText: 'Box eSign' },
    })
  })

  it('keeps equal secret values tied to their exact resolver paths', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FIRST', plaintext: 'true', encryptedValue: 'encrypted-first' },
      { name: 'SECOND', plaintext: 'true', encryptedValue: 'encrypted-second' },
    ])
    registry.recordResolvedAtInputPath('FIRST', 'true', ['first'])
    registry.recordResolvedInputProjection(['first'], 'true', '{{FIRST}}')
    registry.recordResolvedAtInputPath('SECOND', 'true', ['second'])
    registry.recordResolvedInputProjection(['second'], 'true', '{{SECOND}}')

    const projection = projectResolvedModelInput(
      registry,
      { first: 'true', second: 'true', publicValue: 'true' },
      [['first'], ['second']]
    )

    expect(projection).toMatchObject({
      complete: true,
      value: { first: '{{FIRST}}', second: '{{SECOND}}', publicValue: 'true' },
    })
  })

  it('distinguishes schema annotations from a property whose name is an annotation keyword', () => {
    const selection = selectModelSchemaInputPaths(
      {
        type: 'object',
        description: 'Model-facing help',
        properties: {
          description: {
            type: 'string',
            description: 'Property help',
            enum: ['contract-value'],
          },
        },
      },
      ['schema']
    )

    expect(selection.annotationInputPaths).toEqual(
      expect.arrayContaining([
        ['schema', 'description'],
        ['schema', 'properties', 'description', 'description'],
      ])
    )
    expect(selection.semanticInputPaths).toEqual(
      expect.arrayContaining([
        ['schema', 'type'],
        ['schema', 'properties', 'description', 'type'],
        ['schema', 'properties', 'description', 'enum'],
      ])
    )
    expect(selection.annotationInputPaths).not.toContainEqual([
      'schema',
      'properties',
      'description',
    ])
  })

  it('projects schema annotations but rejects changes to semantic values', () => {
    const raw = {
      type: 'object',
      description: 'Private help',
      properties: {
        description: { type: 'string', enum: ['private-option'] },
      },
    }
    const annotationOnly = projectModelSchemaAnnotations(raw, {
      ...raw,
      description: '{{HELP}}',
    })

    expect(annotationOnly).toEqual({
      safe: true,
      value: { ...raw, description: '{{HELP}}' },
    })
    expect(
      projectModelSchemaAnnotations(raw, {
        ...raw,
        properties: {
          description: { type: 'string', enum: ['{{OPTION}}'] },
        },
      })
    ).toEqual({ safe: false })
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

  it('distinguishes an additive projected-input marker from legacy and invalid states', () => {
    expect(inspectModelInputProjectionState(new Headers())).toBe('unmarked')
    expect(
      inspectModelInputProjectionState(
        new Headers({ [PRIVATE_MODEL_INPUT_STATE_HEADER]: PROJECTED_MODEL_INPUT_PATHS_V1 })
      )
    ).toBe('projected')
    expect(
      inspectModelInputProjectionState(
        new Headers({ [PRIVATE_MODEL_INPUT_STATE_HEADER]: 'unsupported-state' })
      )
    ).toBe('invalid')
  })

  it('preserves headerless legacy opaque inputs for external and internal callers', () => {
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
    ).toEqual({ success: true })

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

  it('rejects a partial opaque-input envelope', () => {
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
