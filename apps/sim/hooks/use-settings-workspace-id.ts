import { useParams } from 'next/navigation'
import { useOptionalWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'

/** The pane's canonical environment wins over a containing route's workspace. */
export function useSettingsWorkspaceId(): string {
  const host = useOptionalWorkspaceHostContext()
  const params = useParams<{ workspaceId?: string }>()
  return host?.workspace.id ?? params?.workspaceId ?? ''
}
