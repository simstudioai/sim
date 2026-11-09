'use client'

import { useQueryStates } from 'nuqs'
import {
  integrationViewParsers,
  serializeIntegrationView,
} from '@/lib/organizations/integrations-search-params'
import { useDeleteWorkspaceCredential, useWorkspaceCredentials } from '@/hooks/queries/credentials'
import { useDesktopOAuthConnectListener, useOAuthReturnRouter } from '@/hooks/use-oauth-return'
import { skillWorkspaceParams } from '@/platform/lib/integrations/center-navigation'

/**
 * One workspace's connected credentials, as legacy's workspace Integrations page read them, and
 * the actions on them. A provider's sign-in returns to this page, which then reports the outcome.
 */
export function useWorkspaceConnections(workspaceId: string | undefined) {
  useOAuthReturnRouter(workspaceId ? { scope: { workspaceId } } : undefined)
  useDesktopOAuthConnectListener()
  const credentials = useWorkspaceCredentials({ workspaceId })
  const remove = useDeleteWorkspaceCredential(workspaceId)
  return {
    credentials,
    pending: remove.isPending,
    /** Settles with the deletion, so a confirming dialog stays open and reports a failure. */
    disconnect: (credentialId: string) => remove.mutateAsync(credentialId),
  }
}

/**
 * The page's URL state: the account a detail page opens, and the workspace every tab lists within.
 * Choosing a workspace reloads the server's verdict on which apps that workspace may use.
 */
export function useWorkspaceIntegrationsView() {
  const [{ account }, setView] = useQueryStates(integrationViewParsers)
  const [, setWorkspace] = useQueryStates(skillWorkspaceParams, {
    history: 'push',
    shallow: false,
  })
  return {
    account,
    clearAccount: () => void setView({ account: null, tools: null }),
    serialize: serializeIntegrationView,
    chooseWorkspace: (workspace: string) => void setWorkspace({ workspace }),
  }
}
