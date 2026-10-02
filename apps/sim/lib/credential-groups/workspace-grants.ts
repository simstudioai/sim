import { z } from 'zod'
import { ORGANIZATION_CREDENTIAL_TYPES } from '@/lib/credential-groups/credential-types'
import { ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT } from '@/lib/credential-groups/limits'
import { workspaceResourcePolicyPrincipalSchema } from '@/lib/resource-policies/principals/workspace'

export const organizationCredentialTypeSchema = z.enum(ORGANIZATION_CREDENTIAL_TYPES, {
  error: 'Unknown credential type',
})

export const organizationAccountWorkspaceGrantSchema = z
  .object({
    workspaceId: workspaceResourcePolicyPrincipalSchema.shape.workspaceId,
    access: z.discriminatedUnion('mode', [
      z.object({ mode: z.literal('all') }).strict(),
      z
        .object({
          mode: z.literal('selected'),
          credentialTypes: z
            .array(organizationCredentialTypeSchema)
            .min(1, 'Select at least one credential type')
            .max(ORGANIZATION_CREDENTIAL_TYPES.length)
            .refine(
              (types) => new Set(types).size === types.length,
              'Credential types must be unique'
            ),
        })
        .strict(),
    ]),
  })
  .strict()

export const organizationAccountWorkspaceGrantsSchema = z
  .array(organizationAccountWorkspaceGrantSchema)
  .max(ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT)
  .refine(
    (grants) => new Set(grants.map((grant) => grant.workspaceId)).size === grants.length,
    'Workspace grants must be unique'
  )

export type OrganizationAccountWorkspaceGrant = z.output<
  typeof organizationAccountWorkspaceGrantSchema
>

/** An explicit project rule follows its current and future environments. */
export const organizationAccountProjectGrantSchema = z
  .object({
    projectId: z.string().trim().min(1).max(128),
    access: organizationAccountWorkspaceGrantSchema.shape.access,
  })
  .strict()
export const organizationAccountProjectGrantsSchema = z
  .array(organizationAccountProjectGrantSchema)
  .max(ORGANIZATION_ACCOUNT_WORKSPACE_LIMIT)
  .refine(
    (grants) => new Set(grants.map((grant) => grant.projectId)).size === grants.length,
    'Project grants must be unique'
  )
export type OrganizationAccountProjectGrant = z.output<typeof organizationAccountProjectGrantSchema>
