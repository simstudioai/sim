'use client'

import { useEffect, useRef } from 'react'
import { toast } from '@sim/emcn'
import { useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { listWorkspaceCredentialsContract } from '@/lib/api/contracts'
import {
  ADD_CONNECTOR_SEARCH_PARAM,
  consumeOAuthReturnContext,
  type OAuthReturnContext,
  readOAuthReturnContext,
} from '@/lib/credentials/client-state'
import { getDesktopBridge } from '@/lib/desktop'
import { oauthConnectionsKeys } from '@/hooks/queries/oauth/oauth-connections'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'

const OAUTH_CREDENTIAL_UPDATED_EVENT = 'oauth-credentials-updated'
const SETTINGS_RETURN_URL_KEY = 'settings-return-url'
const CONTEXT_MAX_AGE_MS = 15 * 60 * 1000

async function resolveOAuthMessage(ctx: OAuthReturnContext): Promise<string> {
  if (ctx.reconnect) {
    return `"${ctx.displayName}" reconnected successfully.`
  }

  try {
    const data = await requestJson(listWorkspaceCredentialsContract, {
      query: { workspaceId: ctx.workspaceId, type: 'oauth' },
    })
    const oauthCredentials = data.credentials ?? []

    const forProvider = oauthCredentials.filter((c) => c.providerId === ctx.providerId)
    if (forProvider.length > ctx.preCount) {
      return `"${ctx.displayName}" credential connected successfully.`
    }

    const existing = forProvider[0]
    return `This account is already connected as "${existing?.displayName || ctx.displayName}".`
  } catch {
    return `"${ctx.displayName}" credential connected successfully.`
  }
}

function dispatchCredentialUpdate(ctx: OAuthReturnContext) {
  window.dispatchEvent(
    new CustomEvent(OAUTH_CREDENTIAL_UPDATED_EVENT, {
      detail: { providerId: ctx.providerId, workspaceId: ctx.workspaceId },
    })
  )
}

/**
 * Post-OAuth router for the integrations page.
 *
 * After OAuth, Better Auth redirects back to `callbackURL` which is the integrations page.
 * This hook reads the stored return context to determine the original initiator:
 *
 * - `integrations`: Stay on this page, show a toast notification.
 * - `workflow`: Redirect to the specific workflow. The workflow page picks up the context.
 * - `kb-connectors`: Redirect to the KB page. The KB page picks up the context.
 */
export function useOAuthReturnRouter() {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current) return
    const ctx = readOAuthReturnContext()
    if (!ctx) return
    if (Date.now() - ctx.requestedAt > CONTEXT_MAX_AGE_MS) {
      consumeOAuthReturnContext()
      return
    }

    handledRef.current = true

    if (ctx.origin === 'integrations') {
      consumeOAuthReturnContext()
      void (async () => {
        const message = await resolveOAuthMessage(ctx)
        toast.success(message)
        dispatchCredentialUpdate(ctx)
      })()
      return
    }

    if (ctx.origin === 'workflow') {
      try {
        sessionStorage.removeItem(SETTINGS_RETURN_URL_KEY)
      } catch {}
      router.replace(`/workspace/${workspaceId}/w/${ctx.workflowId}`)
      return
    }

    if (ctx.origin === 'kb-connectors') {
      try {
        sessionStorage.removeItem(SETTINGS_RETURN_URL_KEY)
      } catch {}
      const kbUrl = `/workspace/${workspaceId}/knowledge/${ctx.knowledgeBaseId}`
      const connectorParam = ctx.connectorType
        ? `?${ADD_CONNECTOR_SEARCH_PARAM}=${encodeURIComponent(ctx.connectorType)}`
        : ''
      router.replace(`${kbUrl}${connectorParam}`)
      return
    }
  }, [router, workspaceId])
}

/**
 * Post-OAuth handler for workflow pages.
 * Consumes the return context and shows a workflow-scoped notification.
 */
export function useOAuthReturnForWorkflow(workflowId: string) {
  useEffect(() => {
    const ctx = readOAuthReturnContext()
    if (!ctx || ctx.origin !== 'workflow') return
    if (ctx.workflowId !== workflowId) return
    consumeOAuthReturnContext()
    if (Date.now() - ctx.requestedAt > CONTEXT_MAX_AGE_MS) return

    void (async () => {
      const message = await resolveOAuthMessage(ctx)
      toast.success(message)
      dispatchCredentialUpdate(ctx)
    })()
  }, [workflowId])
}

/**
 * Post-OAuth handler for KB connectors pages.
 * Consumes the return context and shows a toast notification.
 */
export function useOAuthReturnForKBConnectors(knowledgeBaseId: string) {
  useEffect(() => {
    const ctx = readOAuthReturnContext()
    if (!ctx || ctx.origin !== 'kb-connectors') return
    if (ctx.knowledgeBaseId !== knowledgeBaseId) return
    consumeOAuthReturnContext()
    if (Date.now() - ctx.requestedAt > CONTEXT_MAX_AGE_MS) return

    void (async () => {
      const message = await resolveOAuthMessage(ctx)
      toast.success(message)
      dispatchCredentialUpdate(ctx)
    })()
  }, [knowledgeBaseId])
}

/**
 * Desktop-app counterpart of the post-OAuth routers above. In the desktop
 * app the whole OAuth flow runs in the system browser (see
 * useConnectOAuthService), so the app never navigates: completion arrives as
 * a bridge push when the browser bounces the desktop's loopback. The app is
 * already refocused by then — this refreshes the credential caches and shows
 * the same connected toast the web flow gets. Mounted once per workspace; a
 * no-op outside the desktop app.
 */
export function useDesktopOAuthConnectListener() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const bridge = getDesktopBridge()
    if (!bridge?.onOAuthConnectComplete) return

    return bridge.onOAuthConnectComplete((result) => {
      void queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() })
      void queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.all })

      const ctx = readOAuthReturnContext()
      if (ctx) consumeOAuthReturnContext()

      if (!result.ok) {
        toast.error('The account connection didn’t finish. Try connecting again.')
        return
      }
      if (ctx) {
        void (async () => {
          const message = await resolveOAuthMessage(ctx)
          toast.success(message)
          dispatchCredentialUpdate(ctx)
        })()
        return
      }
      toast.success('Credential connected successfully.')
    })
  }, [queryClient])
}
