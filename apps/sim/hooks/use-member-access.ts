'use client'

import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

/**
 * Whether per-member knowledge access is on for the routed workspace, as
 * `isKnowledgeMemberAccessAvailable` judged it, resolved once into the
 * workspace host context.
 *
 * The single client-side reading of that judgement, so no surface can drift
 * into offering a feature the server refuses. Outside a workspace route there
 * is no workspace to judge, so it reads false.
 */
export function useMemberAccessAvailable(): boolean {
  return useOptionalWorkspaceHostContext()?.features?.knowledgeMemberAccess === true
}
