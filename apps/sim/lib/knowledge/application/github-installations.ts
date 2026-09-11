import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import {
  credential,
  credentialGroup,
  credentialGroupEnrollment,
  credentialMember,
  member,
} from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { LIVE_ENROLLMENT_STATUSES } from '@/lib/credential-groups/credentials'
import { getCredentialGroupProviderAdapter } from '@/lib/credential-groups/provider-registry'
import {
  ManagedOAuthCredentialError,
  resolveManagedOAuthToken,
} from '@/lib/credentials/managed-oauth'
import type { DbOrTx } from '@/lib/db/types'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  GitHubInstallationError,
  getGitHubInstallationConfiguration,
  listUserAdminGitHubInstallations,
  verifyGitHubInstallationBinding,
} from '@/lib/oauth/github-installation'
import {
  GITHUB_INSTALLATION_PROVIDER_ID,
  type GitHubInstallationSummary,
} from '@/lib/oauth/github-installation-types'

interface InstallationInput {
  organizationId: string
  signal?: AbortSignal
}

interface ConnectInstallationInput extends InstallationInput {
  installationId: string
}

/** Selects only the acting person's live, organization-bound GitHub connection. */
export async function findGitHubSearchReaderCredential(
  executor: DbOrTx,
  organizationId: string,
  userId: string
) {
  const policy = await getCredentialGroupProviderAdapter('github-repositories').getPolicy(
    undefined,
    { organizationId }
  )
  const rows = await executor
    .select({
      id: credential.id,
      authorizationAppId: credential.authorizationAppId,
      groupId: credentialGroup.id,
      subjectId: credential.providerSubjectId,
    })
    .from(credential)
    .innerJoin(
      credentialGroupEnrollment,
      eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
    )
    .innerJoin(credentialGroup, eq(credentialGroup.id, credentialGroupEnrollment.credentialGroupId))
    .where(
      and(
        eq(credential.organizationId, organizationId),
        eq(credentialGroup.organizationId, organizationId),
        eq(credentialGroupEnrollment.userId, userId),
        eq(credential.type, 'managed_oauth'),
        eq(credential.providerId, 'github-repositories'),
        eq(credential.managedOauthStatus, 'active'),
        eq(credential.authorizationAppId, policy.authorizationAppId),
        eq(credential.managedOauthScopeVersion, policy.scopeVersion),
        isNull(credential.revokedAt),
        eq(credentialGroup.status, 'active'),
        inArray(credentialGroupEnrollment.status, [...LIVE_ENROLLMENT_STATUSES]),
        isNull(credentialGroupEnrollment.revokedAt),
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${credentialGroup.options}) AS option
        WHERE option->>'id' = ${credential.credentialGroupOptionId}
          AND option->>'provider' = 'github-repositories' AND option->>'status' = 'active')`
      )
    )
    .limit(2)
  if (rows.length > 1)
    throw new OrchestrationError(
      'conflict',
      'Connect one GitHub account for this organization before choosing an installation'
    )
  return rows[0] ?? null
}

async function readerToken(organizationId: string, credentialId: string) {
  return resolveManagedOAuthToken({
    credentialId,
    organizationId,
    expectedProviderId: 'github-repositories',
    requiredScopes: [],
  })
}

export const listGitHubSearchInstallations = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listGitHubInstallations,
  resolveContext: ({ input }: { input: InstallationInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, context }) {
    await requireOrganizationSearchAvailable(context.organizationId)
    const configuration = getGitHubInstallationConfiguration()
    const reader = configuration.configured
      ? await findGitHubSearchReaderCredential(db, context.organizationId, principal.userId)
      : null
    let needsUserConnection = configuration.configured && !reader
    let installations: GitHubInstallationSummary[] = []
    if (reader) {
      try {
        installations = await listUserAdminGitHubInstallations(
          (await readerToken(context.organizationId, reader.id)).accessToken,
          { signal: input.signal }
        )
      } catch (error) {
        /** Only reader-token discovery can request reauthorization; App JWT failures stay errors. */
        if (
          (error instanceof GitHubInstallationError && error.status === 401) ||
          (error instanceof ManagedOAuthCredentialError &&
            error.code === 'MANAGED_CREDENTIAL_NEEDS_REAUTH')
        )
          needsUserConnection = true
        else throw error
      }
    }
    return {
      available: configuration.configured,
      installUrl: configuration.installUrl,
      needsUserConnection,
      installations,
    }
  },
})

export const connectGitHubSearchInstallation = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.connectGitHubInstallation,
  resolveContext: ({ input }: { input: ConnectInstallationInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, context }) {
    await requireOrganizationSearchAvailable(context.organizationId)
    if (!getGitHubInstallationConfiguration().configured)
      throw new OrchestrationError(
        'validation',
        'GitHub App installation indexing is not configured for this environment'
      )
    const reader = await findGitHubSearchReaderCredential(
      db,
      context.organizationId,
      principal.userId
    )
    if (!reader)
      throw new OrchestrationError(
        'validation',
        'Connect your GitHub account before choosing an installation'
      )
    const { accessToken } = await readerToken(context.organizationId, reader.id)
    const binding = await verifyGitHubInstallationBinding(accessToken, input.installationId, {
      signal: input.signal,
    })
    const { encrypted } = await encryptSecret(JSON.stringify(binding))
    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`github-search:${context.organizationId}:${binding.installationId}`}, 0))`
      )
      const [admin] = await tx
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, context.organizationId),
            eq(member.userId, principal.userId),
            inArray(member.role, ['admin', 'owner'])
          )
        )
        .for('update')
        .limit(1)
      if (!admin)
        throw new OrchestrationError('forbidden', 'Organization administrator access is required')
      /** Lock the group before rechecking enrollment, as account configuration and revocation do. */
      await tx
        .select({ id: credentialGroup.id })
        .from(credentialGroup)
        .where(
          and(
            eq(credentialGroup.id, reader.groupId),
            eq(credentialGroup.organizationId, context.organizationId)
          )
        )
        .for('update')
        .limit(1)
      const current = await findGitHubSearchReaderCredential(
        tx,
        context.organizationId,
        principal.userId
      )
      if (
        current?.id !== reader.id ||
        current.authorizationAppId !== reader.authorizationAppId ||
        current.subjectId !== reader.subjectId
      )
        throw new OrchestrationError(
          'conflict',
          'Your GitHub connection changed during setup. Try again.'
        )
      const [existing] = await tx
        .select({ id: credential.id })
        .from(credential)
        .where(
          and(
            eq(credential.organizationId, context.organizationId),
            eq(credential.type, 'service_account'),
            eq(credential.providerId, GITHUB_INSTALLATION_PROVIDER_ID),
            eq(credential.providerSubjectId, binding.installationId),
            eq(credential.authorizationAppId, reader.authorizationAppId!)
          )
        )
        .for('update')
        .limit(1)
      const id = existing?.id ?? generateId()
      const now = new Date()
      const displayName = binding.accountLogin
      const values = {
        displayName,
        encryptedServiceAccountKey: encrypted,
        providerTenantId: binding.accountId,
        revokedAt: null,
        updatedAt: now,
      }
      if (existing) await tx.update(credential).set(values).where(eq(credential.id, id))
      else
        await tx.insert(credential).values({
          id,
          organizationId: context.organizationId,
          workspaceId: null,
          type: 'service_account',
          providerId: GITHUB_INSTALLATION_PROVIDER_ID,
          providerSubjectId: binding.installationId,
          authorizationAppId: reader.authorizationAppId,
          createdBy: principal.userId,
          ...values,
        })
      await tx
        .insert(credentialMember)
        .values({
          id: generateId(),
          credentialId: id,
          userId: principal.userId,
          role: 'admin',
          status: 'active',
          joinedAt: now,
        })
        .onConflictDoUpdate({
          target: [credentialMember.credentialId, credentialMember.userId],
          set: { role: 'admin', status: 'active', joinedAt: now, updatedAt: now },
        })
      return { credential: { id, displayName }, created: !existing }
    })
  },
  projectAudit: ({ result }) => ({
    action: result.created ? AuditAction.CREDENTIAL_CREATED : AuditAction.CREDENTIAL_UPDATED,
    resourceType: AuditResourceType.CREDENTIAL,
    resourceId: result.credential.id,
    resourceName: result.credential.displayName,
    description: 'Connected a GitHub App installation for Search indexing',
  }),
})
