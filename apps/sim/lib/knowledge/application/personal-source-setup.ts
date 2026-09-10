import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeAtlassianSiteUrl } from '@/lib/atlassian/discovery'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  loadManagedCredentialGroupBinding,
  loadScopedAccountsCredentialListContext,
} from '@/lib/credential-groups/credentials'
import { getCredentialGroupOAuthContextForEnrollment } from '@/lib/credential-groups/enrollments'
import { startCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import { readSearchConnectionCompletion } from '@/lib/credential-groups/search-connection-completion'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import { getOwnOrganizationManagedOAuthCredentials } from '@/lib/credentials/organization-managed'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeBillingAttribution } from '@/lib/knowledge/application/billing'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  authorizePersonalSearchSetup,
  authorizePersonalSearchSetupCredential,
  type PersonalSearchSetupConnector,
} from '@/lib/knowledge/application/personal-search-account'
import { configureSimSearchConnector } from '@/lib/knowledge/application/sim-search'
import { provisionKnowledgeConnectorMembersBinding } from '@/lib/knowledge/connectors/member-provisioning'
import { executeSelector } from '@/lib/selectors/application/execute-selector'
import { MAX_SELECTOR_PAGES } from '@/lib/selectors/limits'
import type { SelectorExecutionResult, SelectorRequest } from '@/lib/selectors/types'
import { MAX_PERSONAL_SOURCE_SETUP_KEYS } from '@/lib/sim-search/personal-source-setup'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

const logger = createLogger('PersonalSourceSetup')

interface PersonalSourceSetupOwner {
  organizationId: string
  connectorType: PersonalSearchSetupConnector
}

type PersonalSourceSetupInput = PersonalSourceSetupOwner &
  (
    | { action: 'authorize'; oauthCompletionId: string }
    | { action: 'options'; credentialId: string; domain: string; request: SelectorRequest }
    | { action: 'connect'; credentialId: string; domain: string; keys: string[] }
  )

type PersonalSourceSetupResult =
  | { kind: 'authorization'; url: string }
  | { kind: 'connected'; knowledgeBaseId: string; connectorId: string }
  | SelectorExecutionResult

function normalizeSetupDomain(value: string) {
  let url: URL
  try {
    url = new URL(normalizeAtlassianSiteUrl(value))
  } catch {
    throw new OrchestrationError('validation', 'Enter your Atlassian site hostname')
  }
  if (
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !url.hostname.includes('.')
  ) {
    throw new OrchestrationError(
      'validation',
      'Enter your Atlassian site hostname without a page path'
    )
  }
  return url.hostname
}

/** Lists the viewer's live accounts independently of whether any source exists yet. */
export const listPersonalSourceSetupAccounts = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listPersonalSourceSetupAccounts,
  resolveContext: ({ input }: { input: PersonalSourceSetupOwner & { completionId?: string } }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input }) {
    const userId = await authorizePersonalSearchSetup(principal, input)
    const accounts = await getOwnOrganizationManagedOAuthCredentials({
      organizationId: input.organizationId,
      userId,
      providerId: input.connectorType,
    })
    const completedCredentialId = input.completionId
      ? await readSearchConnectionCompletion({
          organizationId: input.organizationId,
          userId,
          completionId: input.completionId,
        })
      : null
    return {
      accounts: accounts.map((account) => ({
        id: account.id,
        name: account.displayName,
        provider: input.connectorType,
        type: 'managed_oauth' as const,
        scopes: account.scopes,
      })),
      completedCredentialId: accounts.some((account) => account.id === completedCredentialId)
        ? completedCredentialId
        : null,
    }
  },
})

/** Connects the viewer first, then configures only an approved personal-account Search source. */
export const personalSourceSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.personalSourceSetup,
  resolveContext: ({ input }: { input: PersonalSourceSetupInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, context, request }): Promise<PersonalSourceSetupResult> {
    const userId = await authorizePersonalSearchSetup(principal, input)
    if (input.action === 'authorize') {
      const binding = await provisionKnowledgeConnectorMembersBinding({
        organizationId: input.organizationId,
        connectorMeta: CONNECTOR_META_REGISTRY[input.connectorType]!,
        userId,
      })
      const { enrollment, invitationLink } = await createViewerCredentialGroupEnrollment({
        organizationId: input.organizationId,
        userId,
        credentialGroupId: binding.credentialGroupId,
      })
      const token = new URL(invitationLink).pathname.split('/').at(-1)
      if (!token) throw new Error('Account enrollment did not return an invitation token')
      const oauth = await getCredentialGroupOAuthContextForEnrollment(
        {
          organizationId: input.organizationId,
          credentialGroupId: binding.credentialGroupId,
          enrollmentId: enrollment.id,
          email: enrollment.email,
          userId,
        },
        binding.credentialGroupOptionId
      )
      if (!oauth)
        throw new OrchestrationError('forbidden', 'This account connection is no longer available')
      return {
        kind: 'authorization',
        url: await startCredentialGroupOAuth(oauth, token, {
          completionRedirect: true,
          returnTo: 'search',
          completionId: input.oauthCompletionId,
          connectionIntent: { kind: 'create' },
        }),
      }
    }

    await authorizePersonalSearchSetupCredential(principal, input)
    const domain = normalizeSetupDomain(input.domain)
    const selectorInput = {
      selectorKey:
        input.connectorType === 'jira'
          ? ('jira.projectKeys' as const)
          : ('confluence.spaces' as const),
      scope: { kind: 'organization' as const, organizationId: input.organizationId },
      context: { oauthCredential: input.credentialId, domain },
      personalSearchSetup: input.connectorType,
    }
    if (input.action === 'options') {
      return executeSelector.execute({
        principal,
        request,
        input: { ...selectorInput, request: input.request },
      })
    }
    if (
      !input.keys.length ||
      input.keys.length > MAX_PERSONAL_SOURCE_SETUP_KEYS ||
      input.keys.some((key) => !key.trim() || key.length > 255)
    ) {
      throw new OrchestrationError('validation', 'Select between 1 and 1,000 projects or spaces')
    }
    const keys = [...new Set(input.keys.map((key) => key.trim()))]
    const remaining = new Set(keys)
    const cursors = new Set<string>()
    const timeout = AbortSignal.timeout(30_000)
    const signal = request?.signal ? AbortSignal.any([request.signal, timeout]) : timeout
    let cursor: string | undefined
    for (let page = 0; page < MAX_SELECTOR_PAGES; page++) {
      let result: SelectorExecutionResult
      try {
        result = await executeSelector.execute({
          principal,
          request,
          input: {
            ...selectorInput,
            signal,
            request: { kind: 'list', ...(cursor ? { cursor } : {}) },
          },
        })
      } catch (error) {
        if (timeout.aborted && !request?.signal?.aborted) {
          throw new OrchestrationError(
            'validation',
            'Checking the selected projects or spaces took too long. Try fewer selections.'
          )
        }
        throw error
      }
      if (result.kind !== 'list') throw new Error('Source discovery returned an unexpected result')
      for (const option of result.items) remaining.delete(option.id)
      if (remaining.size === 0) break
      if (!result.nextCursor || result.truncated || cursors.has(result.nextCursor)) break
      cursor = result.nextCursor
      cursors.add(cursor)
    }
    if (remaining.size > 0) {
      throw new OrchestrationError(
        'validation',
        'Some selected projects or spaces could not be found with this account. Refresh the choices and try again.'
      )
    }
    const [binding, group] = await Promise.all([
      loadManagedCredentialGroupBinding(input.credentialId),
      loadScopedAccountsCredentialListContext({
        kind: 'organization',
        organizationId: input.organizationId,
      }),
    ])
    if (
      !binding ||
      !group ||
      binding.credentialGroupId !== group.credentialGroupId ||
      binding.organizationId !== input.organizationId
    ) {
      throw new OrchestrationError(
        'not_found',
        'Connect your account again before choosing sources'
      )
    }
    await authorizePersonalSearchSetupCredential(principal, input)
    const result = await configureSimSearchConnector.execute({
      principal,
      request,
      input: {
        organizationId: input.organizationId,
        connectorType: input.connectorType,
        memberCredentialBinding: {
          credentialGroupId: binding.credentialGroupId,
          credentialGroupOptionId: binding.credentialGroupOptionId,
        },
        sourceConfig: {
          domain,
          [input.connectorType === 'jira' ? 'projectKey' : 'spaceKey']: [...keys].join(','),
        },
      },
    })
    try {
      const { dispatchMemberSync } = await import('@/lib/knowledge/connectors/member-queue')
      await dispatchMemberSync(result.connectorId, {
        billingAttribution: await resolveKnowledgeBillingAttribution(principal, context),
      })
    } catch (error) {
      logger.warn('Initial personal source sync will retry on its schedule', {
        error: getErrorMessage(error),
      })
    }
    return { kind: 'connected', ...result }
  },
})
