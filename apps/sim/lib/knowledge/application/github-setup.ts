import type { SessionPrincipal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { credential, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { sha256Hex } from '@sim/security/hash'
import { and, eq } from 'drizzle-orm'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { completePublicCredentialGroupOAuth } from '@/lib/credential-groups/application/public-enrollment'
import { getCredentialGroupOAuthContextForEnrollment } from '@/lib/credential-groups/enrollments'
import { startCredentialGroupOAuth } from '@/lib/credential-groups/oauth'
import {
  CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES,
  isCredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import type { CredentialGroupOAuthAttempt } from '@/lib/credential-groups/oauth-state'
import { readSearchConnectionCompletion } from '@/lib/credential-groups/search-connection-completion'
import { createViewerCredentialGroupEnrollment } from '@/lib/credential-groups/self-enrollment'
import { ManagedOAuthCredentialError } from '@/lib/credentials/managed-oauth'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import {
  connectGitHubSearchInstallation,
  findGitHubSearchReaderCredential,
  listGitHubSearchInstallations,
} from '@/lib/knowledge/application/github-installations'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { provisionKnowledgeConnectorMembersBinding } from '@/lib/knowledge/connectors/member-provisioning'
import {
  expiredGitHubSetupError,
  type GitHubSetupAttempt,
  type GitHubSetupScope,
  githubSetupScope,
  issueGitHubSetupCallback,
  readGitHubSetupAttempt,
  resolveGitHubSetupCallback,
  saveGitHubSetupAttempt,
} from '@/lib/knowledge/github-setup-state'
import { githubSetupCompletionUrl, githubSetupPageUrl } from '@/lib/knowledge/github-setup-urls'
import {
  GitHubInstallationError,
  getGitHubInstallationConfiguration,
} from '@/lib/oauth/github-installation'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'

const logger = createLogger('GitHubSearchSetup')
interface SetupInput {
  organizationId: string
  setupId: string
}
interface SetupSelectionInput extends SetupInput {
  action: { kind: 'select'; installationId: string } | { kind: 'install' }
}
interface SetupCallbackInput {
  state: string
  installationId?: string
  setupAction?: string
}

function safeSetupError(error: unknown): string {
  if (error instanceof ManagedOAuthCredentialError)
    return 'Reconnect your GitHub account, then start setup again.'
  if (error instanceof GitHubInstallationError)
    return error.status === 403
      ? 'Choose a GitHub account or organization you own and allow the required app permissions.'
      : 'GitHub could not finish setup right now. Try again in a few minutes.'
  const classified = asOrchestrationError(error)
  if (classified && ['validation', 'forbidden', 'conflict'].includes(classified.code))
    return classified.message
  return 'GitHub setup could not finish. Try again.'
}

function installationUrl(state: string) {
  const { installUrl } = getGitHubInstallationConfiguration()
  if (!installUrl) throw new OrchestrationError('validation', 'GitHub App setup is unavailable.')
  const url = new URL(installUrl)
  url.searchParams.set('state', state)
  return url.toString()
}

function currentUrl(attempt: GitHubSetupAttempt): string {
  switch (attempt.phase) {
    case 'oauth':
      return attempt.url
    case 'authorizing':
      return githubSetupPageUrl(attempt)
    case 'installing':
      return installationUrl(attempt.state)
    case 'completed':
      return githubSetupCompletionUrl(attempt.setupId)
    case 'failed':
      return githubSetupCompletionUrl(attempt.setupId, 'failed')
    case 'cancelled':
      throw expiredGitHubSetupError()
    default:
      return githubSetupPageUrl(attempt)
  }
}

async function requireAttempt(scope: GitHubSetupScope) {
  const attempt = await readGitHubSetupAttempt(scope)
  if (!attempt || attempt.phase === 'cancelled') throw expiredGitHubSetupError()
  return attempt
}

function base(attempt: GitHubSetupAttempt) {
  return {
    ...githubSetupScope(attempt),
    createdAt: attempt.createdAt,
    ...(attempt.intent ? { intent: attempt.intent } : {}),
  }
}

async function failAttempt(
  attempt: GitHubSetupAttempt,
  error: unknown,
  stage: string = attempt.phase
) {
  logger.warn('GitHub setup failed', {
    stage,
    errorType:
      error instanceof TypeError
        ? 'type_error'
        : error instanceof SyntaxError
          ? 'syntax_error'
          : error instanceof Error
            ? 'error'
            : 'unknown',
    ...(error instanceof Error && { fingerprint: sha256Hex(error.message).slice(0, 12) }),
    failure:
      asOrchestrationError(error)?.code ??
      (error instanceof GitHubInstallationError ? 'provider' : 'unexpected'),
    ...(error instanceof GitHubInstallationError && { providerStatus: error.status }),
  })
  await saveGitHubSetupAttempt(
    { ...base(attempt), phase: 'failed', error: safeSetupError(error) },
    attempt.phase
  )
  return { url: githubSetupCompletionUrl(attempt.setupId, 'failed') }
}

async function connectAttempt(
  principal: SessionPrincipal,
  attempt: GitHubSetupAttempt,
  installationId: string
) {
  const connecting: GitHubSetupAttempt = {
    ...base(attempt),
    phase: 'connecting',
    installationId,
    ...('state' in attempt && attempt.state ? { state: attempt.state } : {}),
  }
  await saveGitHubSetupAttempt(connecting, attempt.phase)
  let result
  try {
    result = await connectGitHubSearchInstallation.execute({
      principal,
      input: {
        organizationId: attempt.organizationId,
        installationId,
        signal: AbortSignal.timeout(60_000),
      },
    })
  } catch (error) {
    return failAttempt(connecting, error)
  }
  /** An interrupted claim expires; a fresh attempt reuses the idempotent installation binding. */
  await saveGitHubSetupAttempt(
    {
      ...base(attempt),
      phase: 'completed',
      credential: result.credential,
    },
    'connecting'
  )
  return { url: githubSetupCompletionUrl(attempt.setupId) }
}

async function installAttempt(attempt: GitHubSetupAttempt) {
  const state = await issueGitHubSetupCallback(attempt)
  await saveGitHubSetupAttempt({ ...base(attempt), phase: 'installing', state }, attempt.phase)
  return { url: installationUrl(state) }
}

async function discoverInstallations(principal: SessionPrincipal, attempt: GitHubSetupAttempt) {
  const result = await listGitHubSearchInstallations.execute({
    principal,
    input: { organizationId: attempt.organizationId, signal: AbortSignal.timeout(60_000) },
  })
  if (!result.available)
    throw new OrchestrationError('validation', 'GitHub App setup is unavailable.')
  if (result.needsUserConnection) return null
  if (attempt.intent === 'install' || result.installations.length === 0)
    return installAttempt(attempt)
  if (result.installations.length === 1)
    return connectAttempt(principal, attempt, result.installations[0]!.installationId)
  await saveGitHubSetupAttempt(
    {
      ...base(attempt),
      phase: 'choosing',
      installations: result.installations.map(
        ({ installationId, accountId, accountLogin, accountType }) => ({
          installationId,
          accountId,
          accountLogin,
          accountType,
        })
      ),
    },
    attempt.phase
  )
  return { url: githubSetupPageUrl(attempt) }
}

async function authorizeReader(attempt: GitHubSetupAttempt) {
  const binding = await provisionKnowledgeConnectorMembersBinding({
    organizationId: attempt.organizationId,
    userId: attempt.userId,
    connectorMeta: CONNECTOR_META_REGISTRY.github!,
  })
  const { enrollment, invitationLink } = await createViewerCredentialGroupEnrollment({
    organizationId: attempt.organizationId,
    userId: attempt.userId,
    credentialGroupId: binding.credentialGroupId,
  })
  const token = new URL(invitationLink).pathname.split('/').at(-1)
  if (!token) throw new Error('Account enrollment did not return an invitation token')
  const context = await getCredentialGroupOAuthContextForEnrollment(
    {
      organizationId: attempt.organizationId,
      credentialGroupId: binding.credentialGroupId,
      enrollmentId: enrollment.id,
      email: enrollment.email,
      userId: attempt.userId,
    },
    binding.credentialGroupOptionId
  )
  if (!context)
    throw new OrchestrationError('forbidden', 'This account connection is no longer available.')
  const [existing] = await db
    .select({ id: credential.id })
    .from(credential)
    .where(
      and(
        eq(credential.organizationId, attempt.organizationId),
        eq(credential.type, 'managed_oauth'),
        eq(credential.credentialGroupEnrollmentId, enrollment.id),
        eq(credential.credentialGroupOptionId, binding.credentialGroupOptionId)
      )
    )
    .limit(1)
  const url = await startCredentialGroupOAuth(context, token, {
    completionRedirect: true,
    completionId: attempt.setupId,
    returnTo: 'github-installation',
    connectionIntent: existing
      ? { kind: 'reconnect', credentialId: existing.id }
      : { kind: 'create' },
  })
  await saveGitHubSetupAttempt({ ...base(attempt), phase: 'oauth', url }, attempt.phase)
  return { url }
}

export const startGitHubSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.startGitHubSetup,
  resolveContext: ({ input }: { input: SetupInput & { intent?: 'install' } }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input }) {
    const scope = {
      organizationId: input.organizationId,
      setupId: input.setupId,
      userId: principal.userId,
      sessionId: principal.sessionId,
    }
    const existing = await readGitHubSetupAttempt(scope)
    if (existing && existing.phase !== 'starting') return { url: currentUrl(existing) }
    if (await readSearchConnectionCompletion({ ...scope, completionId: input.setupId }))
      throw new OrchestrationError('conflict', 'Start a new GitHub setup attempt.')
    const attempt: GitHubSetupAttempt = existing ?? {
      ...scope,
      phase: 'starting',
      createdAt: Date.now(),
      ...(input.intent ? { intent: input.intent } : {}),
    }
    if (!existing) await saveGitHubSetupAttempt(attempt, 'new')
    let stage = 'discovery'
    try {
      const discovered = await discoverInstallations(principal, attempt)
      if (discovered) return discovered
      stage = 'reader_authorization'
      return await authorizeReader(attempt)
    } catch (error) {
      return failAttempt(attempt, error, stage)
    }
  },
})

export const readGitHubSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readGitHubSetup,
  resolveContext: ({ input }: { input: SetupInput }) => resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input }) {
    const attempt = await readGitHubSetupAttempt({
      ...input,
      userId: principal.userId,
      sessionId: principal.sessionId,
    })
    if (!attempt || attempt.phase === 'cancelled') return { status: 'expired' as const }
    if (attempt.phase === 'completed')
      return { status: 'completed' as const, credential: attempt.credential }
    if (attempt.phase === 'failed') return { status: 'failed' as const, error: attempt.error }
    if (attempt.phase === 'choosing')
      return { status: 'choosing' as const, installations: attempt.installations }
    return { status: 'pending' as const }
  },
})

export const cancelGitHubSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.cancelGitHubSetup,
  resolveContext: ({ input }: { input: SetupInput }) => resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input }) {
    const scope = { ...input, userId: principal.userId, sessionId: principal.sessionId }
    for (let retry = 0; retry < 3; retry++) {
      const attempt = await readGitHubSetupAttempt(scope)
      if (attempt?.phase === 'completed' || attempt?.phase === 'connecting') break
      try {
        await saveGitHubSetupAttempt(
          attempt
            ? { ...base(attempt), phase: 'cancelled' }
            : { ...scope, createdAt: Date.now(), phase: 'cancelled' },
          attempt?.phase ?? 'new'
        )
        break
      } catch (error) {
        if (asOrchestrationError(error)?.code !== 'conflict' || retry === 2) throw error
      }
    }
    return { success: true as const }
  },
})

export const continueGitHubSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.continueGitHubSetup,
  resolveContext: ({ input }: { input: SetupInput & { oauth?: string } }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input }) {
    const scope = {
      organizationId: input.organizationId,
      setupId: input.setupId,
      userId: principal.userId,
      sessionId: principal.sessionId,
    }
    const attempt = await requireAttempt(scope)
    if (attempt.phase !== 'oauth' && attempt.phase !== 'authorizing')
      return { url: currentUrl(attempt) }
    if (isCredentialGroupOAuthFailure(input.oauth)) {
      await saveGitHubSetupAttempt(
        {
          ...base(attempt),
          phase: 'failed',
          error: CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES[input.oauth],
        },
        attempt.phase
      )
      return { url: githubSetupCompletionUrl(input.setupId, input.oauth) }
    }
    const receipt = await readSearchConnectionCompletion({
      ...scope,
      completionId: input.setupId,
    })
    const reader = await findGitHubSearchReaderCredential(
      db,
      input.organizationId,
      principal.userId
    )
    if (!receipt || reader?.id !== receipt)
      throw new OrchestrationError(
        'forbidden',
        'Complete GitHub authorization before continuing setup.'
      )
    try {
      const result = await discoverInstallations(principal, attempt)
      if (!result)
        throw new OrchestrationError('forbidden', 'Your GitHub connection is no longer available.')
      return result
    } catch (error) {
      return failAttempt(attempt, error)
    }
  },
})

export const selectGitHubSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.selectGitHubSetup,
  resolveContext: ({ input }: { input: SetupSelectionInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input }) {
    const scope = {
      organizationId: input.organizationId,
      setupId: input.setupId,
      userId: principal.userId,
      sessionId: principal.sessionId,
    }
    const attempt = await requireAttempt(scope)
    if (attempt.phase === 'completed') return { url: currentUrl(attempt) }
    if (attempt.phase === 'connecting') return { url: currentUrl(attempt) }
    if (attempt.phase !== 'choosing')
      throw new OrchestrationError('conflict', 'Refresh GitHub setup before making a selection.')
    if (input.action.kind === 'install') return installAttempt(attempt)
    const { installationId } = input.action
    if (
      !attempt.installations.some((installation) => installation.installationId === installationId)
    )
      throw new OrchestrationError(
        'validation',
        'Choose one of the available GitHub installations.'
      )
    return connectAttempt(principal, attempt, installationId)
  },
})

export const completeGitHubSearchSetup = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.completeGitHubSetup,
  async resolveContext({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: SetupCallbackInput
  }) {
    const scope = await resolveGitHubSetupCallback(input.state, principal)
    return { ...(await resolveKnowledgeOrganizationContext(scope)), setupScope: scope }
  },
  async execute({ principal, input, context }) {
    const attempt = await requireAttempt(context.setupScope)
    if (attempt.phase === 'completed' || attempt.phase === 'failed')
      return { url: currentUrl(attempt) }
    if (
      (attempt.phase !== 'installing' && attempt.phase !== 'connecting') ||
      attempt.state !== input.state
    )
      throw expiredGitHubSetupError()
    if (attempt.phase === 'connecting') {
      if (attempt.installationId !== input.installationId) throw expiredGitHubSetupError()
      return { url: currentUrl(attempt) }
    }
    if (
      !input.installationId ||
      (input.setupAction && !['install', 'update'].includes(input.setupAction))
    )
      return failAttempt(
        attempt,
        new OrchestrationError(
          'validation',
          'GitHub installation was not completed. Ask a GitHub organization owner to install the app, then try again.'
        )
      )
    return connectAttempt(principal, attempt, input.installationId)
  },
})

/** An installation setup keeps its admin authority and cancellation boundary during reader OAuth. */
export const completeGitHubSetupReaderOAuth = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.completeGitHubSetupOAuth,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: SessionPrincipal
    input: { attempt: CredentialGroupOAuthAttempt; code: string }
  }) => {
    const { attempt } = input
    if (
      attempt.provider !== 'github-repositories' ||
      attempt.returnTo !== 'github-installation' ||
      !attempt.organizationId ||
      !attempt.completionId ||
      attempt.userId !== principal.userId
    )
      throw expiredGitHubSetupError()
    return resolveKnowledgeOrganizationContext({ organizationId: attempt.organizationId })
  },
  async execute({ principal, input, context, request }) {
    const scope = {
      organizationId: context.organizationId,
      setupId: input.attempt.completionId!,
      userId: principal.userId,
      sessionId: principal.sessionId,
    }
    const setup = await requireAttempt(scope)
    if (
      setup.phase !== 'oauth' ||
      new URL(setup.url).searchParams.get('state') !== input.attempt.state
    )
      throw expiredGitHubSetupError()
    const [viewer] = await db
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, principal.userId))
      .limit(1)
    if (!viewer?.emailVerified)
      throw new OrchestrationError('forbidden', 'Verify your Sim email before connecting GitHub.')
    await saveGitHubSetupAttempt({ ...base(setup), phase: 'authorizing', url: setup.url }, 'oauth')
    return completePublicCredentialGroupOAuth.execute({
      principal: {
        kind: 'credential_group_enrollment',
        userId: principal.userId,
        organizationId: scope.organizationId,
        credentialGroupId: input.attempt.credentialGroupId,
        enrollmentId: input.attempt.enrollmentId,
        email: input.attempt.email,
        invitationTokenHash: sha256Hex(input.attempt.invitationToken),
      },
      input,
      request,
    })
  },
})
