/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => mockLogger,
}))

import { privateSecretProvenanceBundleSchema } from '@/lib/api/contracts/primitives'
import {
  createModelInputProvenanceRequestMetadata,
  createPrivateSecretProvenanceRequestMetadata,
  inspectModelInputProjectionState,
  inspectModelInputProvenanceRequest,
  isPrivateSecretProvenanceBundleV1,
  PRIVATE_MODEL_INPUT_PROVENANCE_HEADER,
  PRIVATE_MODEL_INPUT_STATE_HEADER,
  PROJECTED_MODEL_INPUT_PATHS_V1,
  type PrivateSecretProvenanceSelection,
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

/** One selection per populated cell, the shape `selectTableRowSecretProvenance` produces. */
function cellSelections(rows: number, columns: number): PrivateSecretProvenanceSelection[] {
  const selections: PrivateSecretProvenanceSelection[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      selections.push({
        key: JSON.stringify([row, `column${column}`]),
        inputPaths: [['rows', String(row), `column${column}`]],
      })
    }
  }
  return selections
}

describe('private secret provenance bundle', () => {
  const scope = { userId: 'user-1', workspaceId: 'workspace-1' }

  /**
   * A 25-column table insert crossed the removed selection cap at 401 rows, and crossing it made
   * the whole bundle incomplete — so every row of the write landed `unknown` in its durable
   * sidecar. The count here is the production write that surfaced it.
   *
   * Every cell resolves a secret, which is also what guards the cost: answering each selection by
   * rescanning the resolved paths is quadratic at this width and cannot finish inside the default
   * timeout, so a reintroduced per-group scan fails here rather than in production.
   */
  it('vouches for a write far wider than the removed selection cap', () => {
    const registry = new ResolvedSecretTraceRegistry([ENTRY], scope)
    const selections = cellSelections(500, 25)
    expect(selections).toHaveLength(12_500)
    for (const selection of selections) {
      registry.recordResolvedAtInputPath(ENTRY.name, ENTRY.plaintext, selection.inputPaths[0])
    }

    const metadata = createPrivateSecretProvenanceRequestMetadata(registry, selections)

    expect(metadata?.provenance.complete).toBe(true)
    expect(metadata?.provenance.selections).toHaveLength(12_500)
    expect(isPrivateSecretProvenanceBundleV1(metadata?.provenance)).toBe(true)
    expect(
      metadata?.provenance.selections.every(
        (selection) => selection.provenance.entries.length === 1
      )
    ).toBe(true)
  })

  it('still narrows a wide write to the one cell that carried a secret', () => {
    const registry = new ResolvedSecretTraceRegistry([ENTRY], scope)
    registry.recordResolvedAtInputPath(ENTRY.name, ENTRY.plaintext, ['rows', '7', 'column3'])

    const metadata = createPrivateSecretProvenanceRequestMetadata(registry, cellSelections(500, 25))

    expect(
      metadata?.provenance.selections.filter((selection) => selection.provenance.entries.length > 0)
    ).toEqual([
      {
        key: JSON.stringify([7, 'column3']),
        provenance: expect.objectContaining({
          complete: true,
          entries: [{ name: ENTRY.name, encryptedValue: ENTRY.encryptedValue }],
        }),
      },
    ])
  })

  it('fails the bundle and names the cause when an input path cannot be vouched for', async () => {
    const registry = new ResolvedSecretTraceRegistry([ENTRY], scope)
    registry.recordResolvedAtInputPath(ENTRY.name, ENTRY.plaintext, ['rows', '0', 'column0'])
    await registry.importProvenanceForValueAtInputPath(
      null,
      ENTRY.plaintext,
      ['rows', '1', 'column1'],
      { trusted: false }
    )
    mockLogger.error.mockClear()

    const metadata = createPrivateSecretProvenanceRequestMetadata(registry, cellSelections(3, 3))

    expect(metadata?.provenance.complete).toBe(false)
    expect(metadata?.provenance.selections).toEqual([])
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Private secret provenance bundle is incomplete',
      expect.objectContaining({ failure: 'registry-incomplete', selectionCount: 9 })
    )
  })

  it('rejects a duplicate selection key without consulting the registry', () => {
    const registry = new ResolvedSecretTraceRegistry([], scope)
    const exportGroups = vi.spyOn(registry, 'exportCommittedProvenanceForInputPathGroups')

    const metadata = createPrivateSecretProvenanceRequestMetadata(registry, [
      { key: 'same', inputPaths: [['rows', '0', 'a']] },
      { key: 'same', inputPaths: [['rows', '1', 'b']] },
    ])

    expect(metadata?.provenance.complete).toBe(false)
    expect(exportGroups).not.toHaveBeenCalled()
  })
})

/**
 * The sender, the runtime type guard, and the route contract each used to enforce their own
 * selection count. Removing it from two of the three would have converted a silently
 * under-recorded write into a rejected one — worse than the bug being fixed — so the agreement
 * is pinned end to end at the width that surfaced it rather than layer by layer.
 */
describe('private secret provenance bundle crosses its own contract', () => {
  it('accepts a bundle at the width that used to trip every layer', () => {
    const registry = new ResolvedSecretTraceRegistry([ENTRY], {
      userId: 'user-1',
      workspaceId: 'workspace-1',
    })
    const selections = cellSelections(500, 25)
    for (const selection of selections) {
      registry.recordResolvedAtInputPath(ENTRY.name, ENTRY.plaintext, selection.inputPaths[0])
    }

    const metadata = createPrivateSecretProvenanceRequestMetadata(registry, selections)

    expect(metadata?.provenance.selections).toHaveLength(12_500)
    expect(privateSecretProvenanceBundleSchema.safeParse(metadata?.provenance).success).toBe(true)
  })
})
