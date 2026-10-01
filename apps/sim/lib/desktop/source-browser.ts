import { z } from 'zod'
import { requestJson } from '@/lib/api/client/request'
import { startSlackCredentialGroupConfigurationContract } from '@/lib/api/contracts/credential-groups'
import {
  consumeDesktopSourceRequestContract,
  type DesktopSourceRequest,
} from '@/lib/api/contracts/desktop-source-connect'
import { startKnowledgeConnectorMemberEnrollmentContract } from '@/lib/api/contracts/knowledge/connectors'
import {
  gitHubSearchSetupScopeSchema,
  readGitHubSearchSetupContract,
  startGitHubSearchSetupContract,
} from '@/lib/api/contracts/knowledge/github-setup'
import { connectPersonalSearchIntegrationContract } from '@/lib/api/contracts/knowledge/personal-integrations'
import { startSlackSearchOAuthContract } from '@/lib/api/contracts/knowledge/slack'
import {
  reconnectPersonalOrganizationAccountContract,
  startOrganizationAccountConnectionContract,
  startOrganizationSlackConfigurationContract,
} from '@/lib/api/contracts/organization-accounts'
import { buildConnectCompletePath } from '@/app/desktop/connect/validation'

const STORAGE_KEY = 'sim:desktop-source-connect'
const contextSchema = z.object({
  state: z.string().regex(/^[A-Za-z0-9_-]{16,256}$/),
  port: z.number().int().min(1024).max(65535),
  expiresAt: z.number(),
  match: z.object({
    kind: z.enum(['completion', 'enrollment', 'slack-search', 'slack-managed-users']),
    id: z.string().min(1).max(512),
  }),
  github: gitHubSearchSetupScopeSchema.optional(),
})
type SourceContext = z.output<typeof contextSchema>
export type DesktopSourceCompletion = SourceContext['match'] & { error?: string }

function readContext(): SourceContext | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    const parsed = contextSchema.safeParse(raw ? JSON.parse(raw) : null)
    if (parsed.success && parsed.data.expiresAt > Date.now()) return parsed.data
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* Storage may be disabled in the system browser. */
  }
  return null
}

function enrollmentMatch(invitationLink: string): SourceContext['match'] {
  const url = new URL(invitationLink, window.location.origin)
  const token = url.pathname.match(/^\/credential-groups\/enroll\/([^/]+)$/)?.[1]
  if (url.origin !== window.location.origin || !token)
    throw new Error('Invalid account connection link')
  return { kind: 'enrollment', id: decodeURIComponent(token) }
}

async function startRequest(
  request: DesktopSourceRequest
): Promise<{ url: string; match: SourceContext['match']; github?: SourceContext['github'] }> {
  switch (request.kind) {
    case 'slack-search': {
      const result = await requestJson(startSlackSearchOAuthContract, { body: request.body })
      const state = new URL(result.authorizationUrl).searchParams.get('state')
      if (!state) throw new Error('Invalid Slack authorization link')
      return { url: result.authorizationUrl, match: { kind: 'slack-search', id: state } }
    }
    case 'github-setup': {
      const result = await requestJson(startGitHubSearchSetupContract, { body: request.body })
      return {
        url: result.url,
        match: { kind: 'completion', id: request.body.setupId },
        github: { organizationId: request.body.organizationId, setupId: request.body.setupId },
      }
    }
    case 'organization-account':
    case 'reconnect-account': {
      const result =
        request.kind === 'organization-account'
          ? await requestJson(startOrganizationAccountConnectionContract, {
              params: { id: request.organizationId },
              body: request.body,
            })
          : await requestJson(reconnectPersonalOrganizationAccountContract, {
              params: { credentialId: request.credentialId },
              query: { oauthCompletionId: request.completionId },
            })
      const completionId =
        request.kind === 'organization-account'
          ? request.body.oauthCompletionId
          : request.completionId
      return {
        url: result.authorizationUrl ?? result.invitationLink,
        match: completionId
          ? { kind: 'completion', id: completionId }
          : enrollmentMatch(result.invitationLink),
      }
    }
    case 'personal-search': {
      const result = await requestJson(connectPersonalSearchIntegrationContract, {
        body: request.body,
      })
      if (!request.body.oauthCompletionId) throw new Error('Missing connection attempt')
      return {
        url: result.data.url,
        match: { kind: 'completion', id: request.body.oauthCompletionId },
      }
    }
    case 'member-enrollment': {
      const result = await requestJson(startKnowledgeConnectorMemberEnrollmentContract, {
        params: request.params,
        query: { oauthCompletionId: request.completionId },
      })
      return {
        url: result.data.url,
        match: request.completionId
          ? { kind: 'completion', id: request.completionId }
          : enrollmentMatch(result.data.url),
      }
    }
    case 'slack-managed-users': {
      const { owner, body, credentialGroupId } = request
      const result = owner.organizationId
        ? await requestJson(startOrganizationSlackConfigurationContract, {
            params: { id: owner.organizationId, groupId: credentialGroupId },
            body: { appId: body.appId!, teamId: body.teamId!, requiredScopes: body.requiredScopes },
          })
        : await requestJson(startSlackCredentialGroupConfigurationContract, {
            params: { id: owner.workspaceId!, groupId: credentialGroupId },
            body,
          })
      return {
        url: result.authorizationUrl,
        match: { kind: 'slack-managed-users', id: result.state },
      }
    }
  }
}

/** Stores only correlation metadata in this tab; secrets stay in the encrypted one-use request. */
export async function startDesktopSourceBrowser(
  requestId: string,
  state: string,
  port: number
): Promise<void> {
  sessionStorage.removeItem(STORAGE_KEY)
  // Storage must work before an authorization attempt is created.
  sessionStorage.setItem(STORAGE_KEY, '{}')
  const request = await requestJson(consumeDesktopSourceRequestContract, { body: { requestId } })
  const result = await startRequest(request)
  const url = new URL(result.url, window.location.origin)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && url.origin === window.location.origin)
  )
    throw new Error('Invalid authorization link')
  const context: SourceContext = {
    state,
    port,
    expiresAt: Date.now() + 10 * 60_000,
    match: result.match,
    ...(result.github ? { github: result.github } : {}),
  }
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(context))
  window.location.replace(url.href)
}

/** Returns only the matching attempt to desktop; native callers refetch authorized server state. */
export async function finishDesktopSourceBrowser(
  completion: DesktopSourceCompletion
): Promise<boolean> {
  const context = readContext()
  if (!context || context.match.kind !== completion.kind || context.match.id !== completion.id)
    return false
  sessionStorage.removeItem(STORAGE_KEY)
  const url = new URL(buildConnectCompletePath(context.state, context.port), window.location.origin)
  if (completion.error)
    url.searchParams.set(
      'error',
      completion.error === 'signin_required' ? 'signin_required' : 'connection_failed'
    )
  else if (context.github) {
    try {
      const result = await requestJson(readGitHubSearchSetupContract, { query: context.github })
      if (result.data.status !== 'completed') throw new Error('GitHub setup is incomplete')
      url.searchParams.set('credentialId', result.data.credential.id)
    } catch {
      url.searchParams.set('error', 'connection_failed')
    }
  }
  window.location.replace(url.href)
  return true
}
