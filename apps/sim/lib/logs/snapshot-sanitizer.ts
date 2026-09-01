import { sanitizeWorkflowForSharing } from '@/lib/workflows/credentials/credential-extractor'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

/**
 * Strips credentials out of an execution's graph snapshot before it leaves the process.
 *
 * The snapshot is the workflow graph as executed, so `blocks[].subBlocks[].value` carries
 * whatever the author typed into a `password: true` field and the credential id behind an
 * `oauth-input`. Redaction is unconditional: every surface that projects a run — the v1 and
 * v2 public APIs — is reachable by an API key that holds no billing or credential authority.
 *
 * `preserveEnvVars` keeps `{{VAR}}` references, which name a workspace environment variable
 * rather than carrying its value — resolution happens at execution time — so the reference is
 * not a secret and is what keeps consecutive run snapshots diffable. Tool parameters without
 * authoritative codec metadata are withheld rather than guessed safe.
 *
 * A run with no retained snapshot projects as `null`, and so does a stored value that is not an
 * object: the sanitizer can make no guarantee about a shape it cannot walk, so it is withheld
 * rather than passed through.
 */
export function sanitizeExecutionSnapshotState(state: unknown): Record<string, unknown> | null {
  if (typeof state !== 'object' || state === null) return null
  return sanitizeWorkflowForSharing(state as Partial<WorkflowState>, {
    preserveEnvVars: true,
    redactOpaqueCredentialInputs: true,
  })
}
