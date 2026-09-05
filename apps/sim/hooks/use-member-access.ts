'use client'

import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

/**
 * Whether per-member knowledge access is on for the routed workspace, as the
 * server judged it: the `knowledge-member-access` flag and Credential Groups,
 * resolved once into the workspace host context.
 *
 * The single client-side reading of that judgement, so every Sim Search
 * surface — the tab, the page, the composer's Search mode, the source rows,
 * and the connector modals — appears and behaves together, and none can drift
 * into offering a feature the server refuses. Outside a workspace route there
 * is no workspace to judge, so it reads false.
 */
export function useMemberAccessAvailable(): boolean {
  return useOptionalWorkspaceHostContext()?.features?.knowledgeMemberAccess === true
}
