import {
  inspectPrivateSecretProvenanceRequest,
  isPrivateSecretProvenanceBundleV1,
} from '@/lib/execution/model-input-provenance'
import {
  type ResolvedSecretTraceProvenanceV1,
  ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'

export const WORKFLOW_EXECUTOR_INPUT_PROVENANCE_KEY = 'input'
export const INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR = 'Invalid workflow input secret provenance'

interface HeaderReader {
  get(name: string): string | null
}

type WorkflowInputProvenanceResolution =
  | { success: true; provenance?: ResolvedSecretTraceProvenanceV1 }
  | { success: false; error: typeof INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR }

/** Normalizes workflow-tool input once for both the functional body and its private sidecar. */
export function normalizeWorkflowExecutorInput(inputMapping: unknown): unknown {
  if (typeof inputMapping !== 'string') return inputMapping || {}

  try {
    return JSON.parse(inputMapping)
  } catch {
    return {}
  }
}

function hasSameEntries(
  left: readonly { name?: string; encryptedValue: string }[],
  right: readonly { name?: string; encryptedValue: string }[]
): boolean {
  if (left.length !== right.length) return false

  const rightEntries = new Set(
    right.map((entry) => JSON.stringify([entry.name ?? null, entry.encryptedValue]))
  )
  return left.every((entry) =>
    rightEntries.has(JSON.stringify([entry.name ?? null, entry.encryptedValue]))
  )
}

/**
 * Authenticates and binds the private sidecar to the exact workflow input crossing the boundary.
 * Headerless requests keep their existing behavior; a negotiated envelope is internal-only.
 */
export async function resolveWorkflowInputSecretProvenance(options: {
  headers: HeaderReader
  payload: unknown
  input: unknown
  isInternalJwt: boolean
  workspaceId: string
}): Promise<WorkflowInputProvenanceResolution> {
  const inspection = inspectPrivateSecretProvenanceRequest(options.headers, options.payload)
  if (inspection.status === 'unsupported') return { success: true }
  if (
    inspection.status !== 'verified' ||
    !options.isInternalJwt ||
    !isPrivateSecretProvenanceBundleV1(inspection.value) ||
    !options.workspaceId
  ) {
    return { success: false, error: INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR }
  }

  if (!inspection.value.complete) {
    return { success: true, provenance: { version: 1, complete: false, entries: [] } }
  }
  if (inspection.value.selections.length !== 1) {
    return { success: false, error: INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR }
  }

  const selection = inspection.value.selections[0]
  const provenance = selection?.provenance
  if (selection?.key !== WORKFLOW_EXECUTOR_INPUT_PROVENANCE_KEY || !provenance) {
    return { success: false, error: INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR }
  }
  if (!provenance.complete) {
    return { success: true, provenance: { version: 1, complete: false, entries: [] } }
  }
  if (provenance.scope?.workspaceId !== options.workspaceId) {
    return { success: false, error: INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR }
  }

  const sourceRegistry = new ResolvedSecretTraceRegistry([], provenance.scope)
  const imported = await sourceRegistry.importProvenance(provenance, {
    trusted: true,
    origin: 'executionInput.secretProvenance',
  })
  const inputProvenance = sourceRegistry.exportProvenanceForValue(options.input)
  if (
    !imported ||
    !sourceRegistry.isComplete() ||
    !inputProvenance.complete ||
    !hasSameEntries(inputProvenance.entries, provenance.entries)
  ) {
    return { success: false, error: INVALID_WORKFLOW_INPUT_PROVENANCE_ERROR }
  }

  return { success: true, provenance: inputProvenance }
}
