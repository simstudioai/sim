import { z } from 'zod'
import { ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT } from '@/lib/credential-groups/limits'
import { evaluateResourcePolicy } from '@/lib/resource-policies/evaluator'
import { workspaceResourcePolicyPrincipalSchema } from '@/lib/resource-policies/principals/workspace'
import { CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION } from '@/lib/resource-policies/registry'
import type { ResourcePolicyCodec } from '@/lib/resource-policies/types'

export const organizationAccountWorkspaceIdsSchema = z
  .array(workspaceResourcePolicyPrincipalSchema.shape.workspaceId)
  .max(ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT)
  .refine((ids) => new Set(ids).size === ids.length, 'Workspace IDs must be unique')

const workspaceAccessStatementSchema = z
  .object({
    sid: z.literal('WorkspaceCredentialAccess'),
    effect: z.literal('allow'),
    actions: z.tuple([z.literal(CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION)]),
    principals: z
      .array(workspaceResourcePolicyPrincipalSchema)
      .min(1)
      .max(ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT),
  })
  .strict()
  .refine(
    ({ principals }) =>
      principals.every(
        (principal, index) =>
          index === 0 || principals[index - 1].workspaceId < principal.workspaceId
      ),
    'Workspace principals must be sorted and unique'
  )

export const organizationAccountAccessPolicySchema = z
  .object({
    version: z.literal(2),
    resource: z
      .object({ type: z.literal('credential_group'), id: z.string().min(1).max(128) })
      .strict(),
    statements: z.array(workspaceAccessStatementSchema).max(1),
  })
  .strict()

export type OrganizationAccountAccessPolicy = z.output<typeof organizationAccountAccessPolicySchema>

export const organizationAccountAccessPolicyCodec: ResourcePolicyCodec<
  'credential_group',
  OrganizationAccountAccessPolicy
> = {
  resourceType: 'credential_group',
  parse(value, expected) {
    const document = organizationAccountAccessPolicySchema.parse(value)
    if (document.resource.type !== expected.type || document.resource.id !== expected.id) {
      throw new Error('Connected accounts policy does not match its canonical group')
    }
    return document
  },
}

export function buildOrganizationAccountAccessPolicy(
  credentialGroupId: string,
  workspaceIds: string[]
): OrganizationAccountAccessPolicy {
  const ids = organizationAccountWorkspaceIdsSchema.parse(workspaceIds).sort()
  return organizationAccountAccessPolicySchema.parse({
    version: 2,
    resource: { type: 'credential_group', id: credentialGroupId },
    statements: ids.length
      ? [
          {
            sid: 'WorkspaceCredentialAccess',
            effect: 'allow',
            actions: [CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION],
            principals: ids.map((workspaceId) => ({ type: 'workspace', workspaceId })),
          },
        ]
      : [],
  })
}

export function listOrganizationAccountWorkspaceIds(
  document: OrganizationAccountAccessPolicy
): string[] {
  return document.statements.flatMap((statement) =>
    statement.principals.map((principal) => principal.workspaceId)
  )
}

export function organizationAccountPolicyAllowsWorkspace(
  document: OrganizationAccountAccessPolicy,
  workspaceId: string
): boolean {
  return (
    evaluateResourcePolicy({
      document,
      action: CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
      facts: { currentWorkspaceId: workspaceId },
    }).decision === 'allow'
  )
}
