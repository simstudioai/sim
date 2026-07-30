import { createLogger } from '@sim/logger'
import { deriveOutputSchema, inputFieldSummaries } from '@/lib/workflows/api-reference/schema'
import type { ApiReferenceVersion } from '@/lib/workflows/api-reference/types'
import {
  listWorkflowVersions,
  loadWorkflowDeploymentVersionState,
} from '@/lib/workflows/persistence/utils'

const logger = createLogger('ApiReferenceChangelog')

interface VersionInterface {
  version: number
  deployedAt: string | null
  /** input field name -> declared type */
  inputs: Map<string, string>
  /** output field names */
  outputs: Set<string>
}

/** The output-schema top-level field names (or `null` when the shape is opaque). */
function outputFieldNames(schema: ReturnType<typeof deriveOutputSchema>): Set<string> {
  return new Set(Object.keys(schema.properties ?? {}))
}

/**
 * Shallow, deliberately-dumb diff between two consecutive deployed interfaces. A
 * change is **breaking** when a required-shaped contract element a caller depends on
 * is removed or retyped: an input field disappears or changes type (a caller still
 * sending it, like the real `selectedApps` regression, silently breaks), or an
 * output field disappears (a caller consuming it breaks). Additions are non-breaking.
 * No attempt at semantic equivalence — honest structural comparison only.
 */
function diffInterfaces(
  prev: VersionInterface,
  curr: VersionInterface
): { breaking: boolean; changes: string[] } {
  const changes: string[] = []
  let breaking = false

  for (const [name, type] of prev.inputs) {
    if (!curr.inputs.has(name)) {
      changes.push(`removed input field \`${name}\``)
      breaking = true
    } else if (curr.inputs.get(name) !== type) {
      changes.push(`retyped input field \`${name}\` (${type} → ${curr.inputs.get(name)})`)
      breaking = true
    }
  }
  for (const name of curr.inputs.keys()) {
    if (!prev.inputs.has(name)) changes.push(`added input field \`${name}\``)
  }

  for (const name of prev.outputs) {
    if (!curr.outputs.has(name)) {
      changes.push(`removed output field \`${name}\``)
      breaking = true
    }
  }
  for (const name of curr.outputs) {
    if (!prev.outputs.has(name)) changes.push(`added output field \`${name}\``)
  }

  return { breaking, changes }
}

/**
 * The version changelog for a workflow, newest first. Computed entirely on-read from
 * the immutable `workflow_deployment_version` snapshots — no changelog is stored.
 * Each entry reports how that version's interface changed relative to its immediate
 * predecessor and whether the change can break existing callers.
 */
export async function computeVersionChangelog(
  workflowId: string,
  providedWorkspaceId?: string
): Promise<ApiReferenceVersion[]> {
  const { versions } = await listWorkflowVersions(workflowId)
  if (versions.length === 0) return []

  const ascending = [...versions].sort((a, b) => a.version - b.version)

  const interfaces: VersionInterface[] = []
  for (const row of ascending) {
    try {
      const state = await loadWorkflowDeploymentVersionState(
        workflowId,
        row.id,
        providedWorkspaceId
      )
      const inputs = new Map(inputFieldSummaries(state.blocks).map((f) => [f.name, f.type]))
      const outputs = outputFieldNames(deriveOutputSchema(state.blocks))
      interfaces.push({
        version: row.version,
        deployedAt: row.createdAt ? row.createdAt.toISOString() : null,
        inputs,
        outputs,
      })
    } catch (error) {
      logger.warn('Failed to load deployment version for changelog', { workflowId, id: row.id })
    }
  }

  const result: ApiReferenceVersion[] = []
  for (let i = 0; i < interfaces.length; i++) {
    const curr = interfaces[i]
    if (i === 0) {
      result.push({
        version: curr.version,
        deployedAt: curr.deployedAt,
        breaking: false,
        changes: ['initial version'],
      })
      continue
    }
    const { breaking, changes } = diffInterfaces(interfaces[i - 1], curr)
    result.push({
      version: curr.version,
      deployedAt: curr.deployedAt,
      breaking,
      changes: changes.length > 0 ? changes : ['no interface change'],
    })
  }

  return result.reverse()
}
