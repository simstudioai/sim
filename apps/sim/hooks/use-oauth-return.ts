'use client'

import { useEffect, useRef } from 'react'
import { toast } from '@sim/emcn'
import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import { createSerializer, parseAsString } from 'nuqs/server'
import { requestJson } from '@/lib/api/client/request'
import { listWorkspaceCredentialsContract } from '@/lib/api/contracts'
import { listOrganizationCredentialsContract } from '@/lib/api/contracts/organization-credentials'
import { type ResourceScope, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import {
  ADD_CONNECTOR_SEARCH_PARAM,
  consumeOAuthReturnContext,
  type OAuthReturnContext,
  readOAuthReturnContext,
} from '@/lib/credentials/client-state'
import {
  hasOAuthCredentialChanged,
  OAUTH_CHAT_ATTEMPT_MAX_AGE_MS,
  OAUTH_CHAT_ATTEMPT_PARAM,
  readOAuthChatAttempt,
  resolveDesktopOAuthChatAttempt,
  setOAuthChatAttemptStatus,
} from '@/lib/credentials/oauth-chat-attempt'
import { getDesktopBridge } from '@/lib/desktop'
import { organizationRoutes } from '@/lib/navigation/paths'
import { stripMicrosoftDataverseEnvironmentFromOAuthCallback } from '@/lib/oauth/microsoft-dataverse'
import { organizationSearchSetupPath } from '@/lib/sim-search/setup-navigation'
import { searchSetupAccessParam } from '@/app/workspace/[workspaceId]/search/search-params'
import { oauthConnectionsKeys } from '@/hooks/queries/oauth/oauth-connections'
import {
  organizationCredentialKeys,
  workspaceCredentialKeys,
} from '@/hooks/queries/utils/credential-keys'
import { requireWorkspaceCredentialListResponse } from '@/hooks/queries/utils/fetch-workspace-credentials'
import { SETTINGS_RETURN_URL_KEY } from '@/hooks/use-settings-navigation'

const OAUTH_CREDENTIAL_UPDATED_EVENT = 'oauth-credentials-updated'
const CONTEXT_MAX_AGE_MS = 15 * 60 * 1000
const serializeConnectorReturn = createSerializer({
  [ADD_CONNECTOR_SEARCH_PARAM]: parseAsString,
  [searchSetupAccessParam.key]: searchSetupAccessParam.parser,
})

export interface OAuthResultMessage {
  kind: 'success' | 'error'
  text: string
  credentialId?: string
}

export async function resolveOAuthMessage(ctx: OAuthReturnContext): Promise<OAuthResultMessage> {
  if (ctx.reconnect) {
    return {
      kind: 'success',
      text: `"${ctx.displayName}" reconnected successfully.`,
    }
  }

  try {
    const scope = resourceScopeFromOwner(ctx)
    const oauthCredentials =
      scope.kind === 'organization'
        ? (
            await requestJson(listOrganizationCredentialsContract, {
              query: { organizationId: scope.organizationId, type: 'oauth' },
            })
          ).credentials
        : requireWorkspaceCredentialListResponse(
            await requestJson(listWorkspaceCredentialsContract, {
              query: { workspaceId: scope.workspaceId, type: 'oauth' },
            })
          )

    const forProvider = oauthCredentials.filter((c) => c.providerId === ctx.providerId)
    const baselineCredentials = new Map(
      ctx.baselineCredentials?.map((credential) => [credential.id, credential]) ?? []
    )
    if (forProvider.length > ctx.preCount) {
      const added = ctx.baselineCredentials
        ? forProvider.filter((credential) => !baselineCredentials.has(credential.id))
        : []
      const connected =
        added.find((credential) => credential.displayName === ctx.displayName) ??
        (added.length === 1 ? added[0] : undefined)
      return {
        kind: 'success',
        text: `"${ctx.displayName}" credential connected successfully.`,
        ...(connected && { credentialId: connected.id }),
      }
    }

    const reauthorizedCredential = forProvider.find((credential) => {
      const baseline = baselineCredentials.get(credential.id)
      return (
        baseline !== undefined &&
        (baseline.accountId !== credential.accountId ||
          (baseline.updatedAt !== undefined && baseline.updatedAt !== credential.updatedAt))
      )
    })
    if (reauthorizedCredential) {
      return {
        kind: 'success',
        text: `This account is already connected as "${reauthorizedCredential.displayName}".`,
        credentialId: reauthorizedCredential.id,
      }
    }
  } catch {
    return {
      kind: 'error',
      text: `We couldn’t verify the "${ctx.displayName}" connection. Try again.`,
    }
  }

  return {
    kind: 'error',
    text: `We couldn’t verify the "${ctx.displayName}" connection. Try again.`,
  }
}

export function resolveOAuthCallbackError(
  callbackUrl: string,
  ctx: Pick<OAuthReturnContext, 'displayName'>
): OAuthResultMessage | null {
  if (!new URL(callbackUrl).searchParams.has('error')) return null
  return {
    kind: 'error',
    text: `The "${ctx.displayName}" connection didn’t finish. Try again.`,
  }
}

function consumeOAuthCallbackError(ctx: OAuthReturnContext): OAuthResultMessage | null {
  const result = resolveOAuthCallbackError(window.location.href, ctx)
  if (!result) return null
  const url = new URL(window.location.href)
  url.searchParams.delete('error')
  url.searchParams.delete('error_description')
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  return result
}

function showOAuthResultMessage(result: OAuthResultMessage): void {
  if (result.kind === 'success') {
    toast.success(result.text)
    return
  }
  toast.error(result.text)
}

interface OAuthCredentialUpdate {
  providerId: string
  workspaceId?: string
  organizationId?: string
  credentialId?: string
  knowledgeBaseId?: string
  connectorType?: string
  connectorId?: string
  requestedAt?: number
}

function dispatchCredentialUpdate(
  ctx:
    | Pick<OAuthReturnContext, 'providerId' | 'workspaceId' | 'organizationId'>
    | OAuthReturnContext,
  result?: OAuthResultMessage
) {
  const detail: OAuthCredentialUpdate = {
    providerId: ctx.providerId,
    workspaceId: ctx.workspaceId,
    organizationId: ctx.organizationId,
  }
  if (
    'origin' in ctx &&
    ctx.origin === 'kb-connectors' &&
    result?.kind === 'success' &&
    result.credentialId
  ) {
    detail.credentialId = result.credentialId
    detail.knowledgeBaseId = ctx.knowledgeBaseId
    detail.connectorType = ctx.connectorType
    detail.connectorId = ctx.connectorId
    detail.requestedAt = ctx.requestedAt
  }
  window.dispatchEvent(
    new CustomEvent(OAUTH_CREDENTIAL_UPDATED_EVENT, {
      detail,
    })
  )
}

function clearOAuthChatAttemptParam(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete(OAUTH_CHAT_ATTEMPT_PARAM)
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

function clearDataverseOAuthEnvironmentParam(): void {
  const current = window.location.href
  const cleaned = stripMicrosoftDataverseEnvironmentFromOAuthCallback(current)
  if (cleaned !== current) {
    const url = new URL(cleaned)
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }
}

const VERIFY_ATTEMPT_TRIES = 4
const VERIFY_BACKOFF_BASE_MS = 400

/**
 * Confirms the credential the chip launched actually landed, then publishes the
 * result to the row that is waiting on it.
 *
 * The read goes through the QueryClient on the key the chips subscribe to, so
 * one request both decides the verdict and refreshes every mounted row —
 * `staleTime: 0` forces a live read rather than reusing the cached list the
 * flow started from.
 */
async function verifyOAuthChatAttempt(queryClient: QueryClient, attemptId: string): Promise<void> {
  const attempt = readOAuthChatAttempt(attemptId)
  if (!attempt || Date.now() - attempt.requestedAt > OAUTH_CHAT_ATTEMPT_MAX_AGE_MS) return

  if (new URL(window.location.href).searchParams.has('error')) {
    setOAuthChatAttemptStatus(attempt.id, 'failed')
    toast.error(`The ${attempt.displayName} connection didn’t finish. Try again.`)
    return
  }

  for (let attemptNumber = 0; attemptNumber < VERIFY_ATTEMPT_TRIES; attemptNumber += 1) {
    try {
      const credentials = await queryClient.fetchQuery({
        queryKey: workspaceCredentialKeys.list(attempt.workspaceId, 'oauth'),
        queryFn: ({ signal }) =>
          requestJson(listWorkspaceCredentialsContract, {
            query: { workspaceId: attempt.workspaceId, type: 'oauth' },
            signal,
          }).then(requireWorkspaceCredentialListResponse),
        staleTime: 0,
      })

      if (hasOAuthCredentialChanged(attempt, credentials)) {
        setOAuthChatAttemptStatus(attempt.id, 'connected')
        dispatchCredentialUpdate(attempt)
        toast.success(`${attempt.displayName} connected successfully.`)
        return
      }
    } catch {
      // A short retry window covers callback hooks committing just after redirect.
    }
    if (attemptNumber < VERIFY_ATTEMPT_TRIES - 1) {
      await sleep(
        backoffWithJitter(attemptNumber + 1, null, {
          baseMs: VERIFY_BACKOFF_BASE_MS,
        })
      )
    }
  }

  setOAuthChatAttemptStatus(attempt.id, 'failed')
  toast.error(`We couldn’t verify the ${attempt.displayName} connection. Try again.`)
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
  const queryClient = useQueryClient()
  const workspaceId = typeof params.workspaceId === 'string' ? params.workspaceId : undefined
  const organizationId =
    typeof params.organizationId === 'string' ? params.organizationId : undefined
  const handledRef = useRef(false)
  const chatAttemptHandledRef = useRef(false)

  useEffect(() => {
    clearDataverseOAuthEnvironmentParam()
    let isChatAttemptReturn = false
    if (!chatAttemptHandledRef.current) {
      const attemptId = new URL(window.location.href).searchParams.get(OAUTH_CHAT_ATTEMPT_PARAM)
      if (attemptId) {
        chatAttemptHandledRef.current = true
        isChatAttemptReturn = true
        void verifyOAuthChatAttempt(queryClient, attemptId).finally(clearOAuthChatAttemptParam)
      }
    }

    if (handledRef.current) return
    const ctx = readOAuthReturnContext()
    if (!ctx) return
    // A chip return carries its own verdict and toast. Any return context still
    // sitting here belongs to an earlier, abandoned modal connect — consume it
    // so it cannot double-toast now or attach to a later completion, the same
    // discard useDesktopOAuthConnectListener does.
    if (isChatAttemptReturn) {
      consumeOAuthReturnContext()
      return
    }
    if (Date.now() - ctx.requestedAt > CONTEXT_MAX_AGE_MS) {
      consumeOAuthReturnContext()
      return
    }

    if (ctx.workspaceId !== workspaceId || ctx.organizationId !== organizationId) return
    handledRef.current = true
    const callbackError = consumeOAuthCallbackError(ctx)
    if (callbackError) {
      consumeOAuthReturnContext()
      showOAuthResultMessage(callbackError)
      if (ctx.origin === 'workflow') {
        router.replace(`/workspace/${ctx.workspaceId}/w/${ctx.workflowId}`)
      } else if (ctx.origin === 'kb-connectors') {
        router.replace(
          buildKnowledgeBaseOAuthReturnUrl(
            resourceScopeFromOwner(ctx),
            ctx.knowledgeBaseId,
            ctx.connectorType,
            ctx.connectorId,
            ctx.sourceAccess
          )
        )
      }
      return
    }

    if (ctx.origin === 'integrations') {
      consumeOAuthReturnContext()
      void (async () => {
        const message = await resolveOAuthMessage(ctx)
        showOAuthResultMessage(message)
        dispatchCredentialUpdate(ctx)
      })()
      return
    }

    if (ctx.origin === 'workflow') {
      try {
        sessionStorage.removeItem(SETTINGS_RETURN_URL_KEY)
      } catch {}
      router.replace(`/workspace/${ctx.workspaceId}/w/${ctx.workflowId}`)
      return
    }

    if (ctx.origin === 'kb-connectors') {
      try {
        sessionStorage.removeItem(SETTINGS_RETURN_URL_KEY)
      } catch {}
      router.replace(
        buildKnowledgeBaseOAuthReturnUrl(
          resourceScopeFromOwner(ctx),
          ctx.knowledgeBaseId,
          ctx.connectorType,
          ctx.connectorId,
          ctx.sourceAccess
        )
      )
      return
    }
  }, [queryClient, router, workspaceId, organizationId])
}

export function buildKnowledgeBaseOAuthReturnUrl(
  owner: string | ResourceScope,
  knowledgeBaseId: string,
  connectorType?: string,
  connectorId?: string,
  sourceAccess?: Extract<OAuthReturnContext, { origin: 'kb-connectors' }>['sourceAccess']
): string {
  const scope =
    typeof owner === 'string' ? { kind: 'workspace' as const, workspaceId: owner } : owner
  if (scope.kind === 'organization' && connectorId) {
    return `${organizationRoutes(scope.organizationId).searchSource(connectorId)}?view=settings`
  }
  const kbUrl =
    scope.kind === 'organization'
      ? organizationSearchSetupPath(scope.organizationId)
      : `/workspace/${scope.workspaceId}/knowledge/${knowledgeBaseId}`
  return connectorType
    ? serializeConnectorReturn(kbUrl, {
        [ADD_CONNECTOR_SEARCH_PARAM]: connectorType,
        [searchSetupAccessParam.key]: scope.kind === 'organization' ? sourceAccess : undefined,
      })
    : kbUrl
}

/**
 * Post-OAuth handler for workflow pages.
 * Consumes the return context and shows a workflow-scoped notification.
 */
export function useOAuthReturnForWorkflow(workflowId: string) {
  useEffect(() => {
    clearDataverseOAuthEnvironmentParam()
    const ctx = readOAuthReturnContext()
    if (!ctx || ctx.origin !== 'workflow') return
    if (ctx.workflowId !== workflowId) return
    consumeOAuthReturnContext()
    if (Date.now() - ctx.requestedAt > CONTEXT_MAX_AGE_MS) return

    const callbackError = consumeOAuthCallbackError(ctx)
    if (callbackError) {
      showOAuthResultMessage(callbackError)
      return
    }

    void (async () => {
      const message = await resolveOAuthMessage(ctx)
      showOAuthResultMessage(message)
      dispatchCredentialUpdate(ctx)
    })()
  }, [workflowId])
}

/**
 * Restores the connected account after a web return or desktop completion.
 */
export function useOAuthReturnForKBConnectors(
  knowledgeBaseId: string | undefined,
  onConnected?: (credentialId: string) => void,
  connectorType?: string,
  explicitScope?: ResourceScope,
  connectorId?: string
) {
  const params = useParams()
  const workspaceId = explicitScope
    ? explicitScope.kind === 'workspace'
      ? explicitScope.workspaceId
      : undefined
    : params?.workspaceId
  const organizationId = explicitScope
    ? explicitScope.kind === 'organization'
      ? explicitScope.organizationId
      : undefined
    : params?.organizationId
  useEffect(() => {
    if (!knowledgeBaseId) return

    const handleCredentialUpdate = (event: Event) => {
      const { detail } = event as CustomEvent<OAuthCredentialUpdate>
      if (
        !detail?.credentialId ||
        detail.knowledgeBaseId !== knowledgeBaseId ||
        detail.connectorType !== connectorType ||
        (connectorId && detail.connectorId !== connectorId) ||
        detail.workspaceId !== workspaceId ||
        detail.organizationId !== organizationId ||
        detail.requestedAt === undefined ||
        Date.now() - detail.requestedAt > CONTEXT_MAX_AGE_MS
      ) {
        return
      }
      onConnected?.(detail.credentialId)
    }
    window.addEventListener(OAUTH_CREDENTIAL_UPDATED_EVENT, handleCredentialUpdate)

    if (!getDesktopBridge()?.onOAuthConnectComplete) {
      clearDataverseOAuthEnvironmentParam()
      const ctx = readOAuthReturnContext()
      if (
        ctx?.origin === 'kb-connectors' &&
        ctx.knowledgeBaseId === knowledgeBaseId &&
        ctx.workspaceId === workspaceId &&
        ctx.organizationId === organizationId &&
        (!connectorId || ctx.connectorId === connectorId) &&
        (!connectorType || ctx.connectorType === connectorType)
      ) {
        consumeOAuthReturnContext()
        if (Date.now() - ctx.requestedAt <= CONTEXT_MAX_AGE_MS) {
          const callbackError = consumeOAuthCallbackError(ctx)
          if (callbackError) {
            showOAuthResultMessage(callbackError)
          } else {
            void (async () => {
              const message = await resolveOAuthMessage(ctx)
              showOAuthResultMessage(message)
              dispatchCredentialUpdate(ctx, message)
            })()
          }
        }
      }
    }

    return () => {
      window.removeEventListener(OAUTH_CREDENTIAL_UPDATED_EVENT, handleCredentialUpdate)
    }
  }, [knowledgeBaseId, onConnected, connectorType, workspaceId, organizationId, connectorId])
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
      void queryClient.invalidateQueries({
        queryKey: oauthConnectionsKeys.connections(),
      })
      void queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.all,
      })
      void queryClient.invalidateQueries({ queryKey: organizationCredentialKeys.lists() })

      // The app stays open across interleaved connect flows, so an abandoned
      // modal-connect can leave a stale context that would attach to a later
      // (e.g. chip) completion and show the wrong provider's message. Discard
      // anything older than the same window the web routers use, mirroring
      // their freshness check.
      const rawCtx = readOAuthReturnContext()
      if (rawCtx) consumeOAuthReturnContext()
      const ctx = rawCtx && Date.now() - rawCtx.requestedAt <= CONTEXT_MAX_AGE_MS ? rawCtx : null
      const chatAttempt = resolveDesktopOAuthChatAttempt(result, result.ok ? 'connected' : 'failed')

      if (!result.ok) {
        toast.error('The account connection didn’t finish. Try connecting again.')
        return
      }
      if (chatAttempt) dispatchCredentialUpdate(chatAttempt)
      if (ctx) {
        void (async () => {
          const message = await resolveOAuthMessage(ctx)
          showOAuthResultMessage(message)
          dispatchCredentialUpdate(ctx, message)
        })()
        return
      }
      toast.success('Credential connected successfully.')
    })
  }, [queryClient])
}
