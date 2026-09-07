import {
  type KnowledgeOrganizationContext,
  resolveKnowledgeOrganizationContext,
} from '@/lib/knowledge/application/contexts'
import { getSelectorManifestEntry, type ServerSelectorKey } from '@/lib/selectors/manifest'
import { SelectorContextUnavailableError } from '@/lib/selectors/server/errors'
import type { SelectorManifestEntry, SelectorScope } from '@/lib/selectors/types'
import type { ActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import { resolveActiveWorkflowApplicationContext } from '@/lib/workflows/application/context'
import type { ActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export type WorkspaceSelectorApplicationContext = (
  | ActiveWorkflowApplicationContext
  | ActiveWorkspaceApplicationContext
) & {
  selectorKey: ServerSelectorKey
  selectorManifest: SelectorManifestEntry
  selectorScope: Exclude<SelectorScope, { kind: 'organization' }>
}

export type SelectorApplicationContext =
  | WorkspaceSelectorApplicationContext
  | (KnowledgeOrganizationContext & {
      selectorKey: ServerSelectorKey
      selectorManifest: SelectorManifestEntry
      selectorScope: Extract<SelectorScope, { kind: 'organization' }>
    })

export async function resolveSelectorApplicationContext(input: {
  selectorKey: ServerSelectorKey
  scope: SelectorScope
}): Promise<SelectorApplicationContext> {
  const selectorManifest = getSelectorManifestEntry(input.selectorKey)
  if (selectorManifest.classification === 'local') {
    throw new SelectorContextUnavailableError()
  }

  if (input.scope.kind === 'organization') {
    if (!selectorManifest.scopeKinds.includes('organization'))
      throw new SelectorContextUnavailableError()
    const context = await resolveKnowledgeOrganizationContext({
      organizationId: input.scope.organizationId,
    })
    return {
      ...context,
      selectorKey: input.selectorKey,
      selectorManifest,
      selectorScope: input.scope,
    }
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
