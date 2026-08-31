import { getSelectorManifestEntry, type ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorContextUnavailableError } from '@/lib/selectors/server/errors'
import type { SelectorManifestEntry, SelectorScope } from '@/lib/selectors/types'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export type SelectorApplicationContext = (
  | ActiveWorkflowApplicationContext
  | ActiveWorkspaceApplicationContext
) & {
  selectorKey: ServerSelectorKey
  selectorManifest: SelectorManifestEntry
  selectorScope: SelectorScope
}

export async function resolveSelectorApplicationContext(input: {
  selectorKey: ServerSelectorKey
  scope: SelectorScope
}): Promise<SelectorApplicationContext> {
  const selectorManifest = getSelectorManifestEntry(input.selectorKey)
  if (selectorManifest.classification === 'local') {
    throw new SelectorContextUnavailableError()
  }

  const workspaceContext =
    input.scope.kind === 'workflow'
      ? await resolveActiveWorkflowApplicationContext({
          workflowId: input.scope.workflowId,
          assertedWorkspaceId: input.scope.workspaceId,
        })
      : await resolveActiveWorkspaceApplicationContext(input.scope.workspaceId)

  return {
    ...workspaceContext,
    selectorKey: input.selectorKey,
    selectorManifest,
    selectorScope: input.scope,
  }
}
