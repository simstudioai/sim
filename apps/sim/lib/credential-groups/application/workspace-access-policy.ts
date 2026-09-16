import { z } from 'zod'
import {
  ORGANIZATION_CREDENTIAL_TYPES,
  type OrganizationCredentialType,
} from '@/lib/credential-groups/credential-types'
import { ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT } from '@/lib/credential-groups/limits'
import {
  type OrganizationAccountWorkspaceGrant,
  organizationAccountWorkspaceGrantsSchema,
  organizationCredentialTypeSchema,
} from '@/lib/credential-groups/workspace-grants'
import { CREDENTIAL_TYPE_CONDITION_KEY } from '@/lib/resource-policies/conditions/credential-type'
import { evaluateResourcePolicy } from '@/lib/resource-policies/evaluator'
import { workspaceResourcePolicyPrincipalSchema } from '@/lib/resource-policies/principals/workspace'
import { CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION } from '@/lib/resource-policies/registry'
import type { ResourcePolicyCodec } from '@/lib/resource-policies/types'

const workspaceAccessStatementSchema = z
  .object({
    sid: z.string().min(1).max(256),
    effect: z.literal('allow'),
    actions: z.tuple([z.literal(CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION)]),
    principals: z
      .array(workspaceResourcePolicyPrincipalSchema)
      .min(1)
      .max(ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT),
    condition: z
      .object({
        StringEquals: z
          .object({ [CREDENTIAL_TYPE_CONDITION_KEY]: organizationCredentialTypeSchema })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((statement, context) => {
    const type = statement.condition?.StringEquals[CREDENTIAL_TYPE_CONDITION_KEY]
    const expectedSid = type ? `WorkspaceCredentialAccess:${type}` : 'WorkspaceCredentialAccess'
    if (statement.sid !== expectedSid)
      context.addIssue({
        code: 'custom',
        message: 'Workspace statement ID must match its credential type',
      })
    if (
      !statement.principals.every(
        (principal, index) =>
          index === 0 || statement.principals[index - 1].workspaceId < principal.workspaceId
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Workspace principals must be sorted and unique',
      })
    }
  })

export const organizationAccountAccessPolicySchema = z
  .object({
    version: z.literal(2),
    resource: z
      .object({ type: z.literal('credential_group'), id: z.string().min(1).max(128) })
      .strict(),
    statements: z
      .array(workspaceAccessStatementSchema)
      .max(ORGANIZATION_CREDENTIAL_TYPES.length + 1),
  })
  .strict()
  .superRefine(({ statements }, context) => {
    const statementIds = new Set(statements.map((statement) => statement.sid))
    if (statementIds.size !== statements.length)
      context.addIssue({ code: 'custom', message: 'Workspace statements must be unique' })
    const unrestricted = new Set(
      statements
        .filter((statement) => !statement.condition)
        .flatMap((statement) => statement.principals.map((principal) => principal.workspaceId))
    )
    const workspaceIds = new Set<string>()
    for (const statement of statements) {
      for (const principal of statement.principals) {
        workspaceIds.add(principal.workspaceId)
        if (statement.condition && unrestricted.has(principal.workspaceId))
          context.addIssue({
            code: 'custom',
            message: 'A workspace cannot have both all and selected credential access',
          })
      }
    }
    if (workspaceIds.size > ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT)
      context.addIssue({ code: 'custom', message: 'Too many workspace grants' })
  })

export type OrganizationAccountAccessPolicy = z.output<typeof organizationAccountAccessPolicySchema>

export const organizationAccountAccessPolicyCodec: ResourcePolicyCodec<
  'credential_group',
  OrganizationAccountAccessPolicy
> = {
  resourceType: 'credential_group',
  parse(value, expected) {
    const document = organizationAccountAccessPolicySchema.parse(value)
    if (document.resource.type !== expected.type || document.resource.id !== expected.id)
      throw new Error('Credential Groups policy does not match its canonical group')
    return document
  },
}

export function buildOrganizationAccountAccessPolicy(
  credentialGroupId: string,
  grants: OrganizationAccountWorkspaceGrant[]
): OrganizationAccountAccessPolicy {
  const parsed = organizationAccountWorkspaceGrantsSchema.parse(grants)
  const byType = new Map<OrganizationCredentialType | 'all', string[]>()
  for (const { workspaceId, access } of parsed) {
    const types = access.mode === 'all' ? ['all' as const] : access.credentialTypes
    for (const type of types) {
      const workspaces = byType.get(type) ?? []
      workspaces.push(workspaceId)
      byType.set(type, workspaces)
    }
  }
  return organizationAccountAccessPolicySchema.parse({
    version: 2,
    resource: { type: 'credential_group', id: credentialGroupId },
    statements: [...byType]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([type, workspaceIds]) => ({
        sid: type === 'all' ? 'WorkspaceCredentialAccess' : `WorkspaceCredentialAccess:${type}`,
        effect: 'allow',
        actions: [CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION],
        principals: workspaceIds.sort().map((workspaceId) => ({ type: 'workspace', workspaceId })),
        ...(type === 'all'
          ? {}
          : { condition: { StringEquals: { [CREDENTIAL_TYPE_CONDITION_KEY]: type } } }),
      })),
  })
}

export function listOrganizationAccountWorkspaceGrants(
  document: OrganizationAccountAccessPolicy
): OrganizationAccountWorkspaceGrant[] {
  const grants = new Map<string, OrganizationAccountWorkspaceGrant>()
  for (const statement of document.statements) {
    const type = statement.condition?.StringEquals[CREDENTIAL_TYPE_CONDITION_KEY]
    for (const { workspaceId } of statement.principals) {
      if (!type) {
        grants.set(workspaceId, { workspaceId, access: { mode: 'all' } })
      } else {
        const existing = grants.get(workspaceId)
        if (existing?.access.mode === 'all') throw new Error('Overlapping workspace grants')
        if (existing) existing.access.credentialTypes.push(type)
        else
          grants.set(workspaceId, {
            workspaceId,
            access: { mode: 'selected', credentialTypes: [type] },
          })
      }
    }
  }
  return [...grants.values()].sort((left, right) =>
    left.workspaceId.localeCompare(right.workspaceId)
  )
}

export function listOrganizationAccountWorkspaceIds(
  document: OrganizationAccountAccessPolicy
): string[] {
  return [
    ...new Set(
      document.statements.flatMap((statement) =>
        statement.principals.map((principal) => principal.workspaceId)
      )
    ),
  ].sort()
}

/** Tests the resource policy with the canonical integration, or any registered integration for a catalog entry point. */
export function organizationAccountPolicyAllowsWorkspace(
  document: OrganizationAccountAccessPolicy,
  workspaceId: string,
  credentialType?: OrganizationCredentialType
): boolean {
  return (credentialType ? [credentialType] : ORGANIZATION_CREDENTIAL_TYPES).some(
    (type) =>
      evaluateResourcePolicy({
        document,
        action: CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
        facts: { currentWorkspaceId: workspaceId, credentialType: type },
      }).decision === 'allow'
  )
}
