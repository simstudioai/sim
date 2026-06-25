import type { SubBlockRecord } from '@/lib/workflows/persistence/remap-internal-ids'
import {
  type ForkRemapKind,
  remapForkSubBlocks,
} from '@/lib/workspaces/fork/remap/remap-references'

/**
 * Resolves a source resource reference to its copied child id, or null when the
 * resource was not copied into the fork. Credentials are never copied (always
 * null), so credential references are cleared.
 */
export type ForkCopyResolver = (kind: ForkRemapKind, sourceId: string) => string | null

/**
 * A `copyWorkflowStateIntoTarget` transform for the initial fork. Runs the shared
 * fork remapper in `create` mode: copyable resources the user selected are
 * rewritten to their child ids; references to resources that were not copied (and
 * all credential references) are cleared so the child workflow's subblocks start
 * empty; env-var `{{KEY}}` references are preserved (name-based, they resolve once
 * the child defines the key).
 */
export function createForkBootstrapTransform(
  resolveCopied: ForkCopyResolver
): (subBlocks: SubBlockRecord) => SubBlockRecord {
  return (subBlocks) => remapForkSubBlocks(subBlocks, resolveCopied, 'create').subBlocks
}
