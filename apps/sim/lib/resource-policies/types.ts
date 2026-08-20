import { z } from 'zod'

export const RESOURCE_POLICY_VERSION = 1 as const
export const RESOURCE_POLICY_RESOURCE_TYPES = ['credential_group'] as const
export const RESOURCE_POLICY_ACTIONS = [
  'credential_groups.credentials.list',
  'credential_groups.credentials.use',
] as const
export type ResourcePolicyResourceType = (typeof RESOURCE_POLICY_RESOURCE_TYPES)[number]
export type ResourcePolicyAction = (typeof RESOURCE_POLICY_ACTIONS)[number]

export const RESOURCE_POLICY_ACTIONS_BY_RESOURCE = {
  credential_group: RESOURCE_POLICY_ACTIONS,
} as const satisfies Record<ResourcePolicyResourceType, readonly ResourcePolicyAction[]>

const userSubjectSchema = z
  .object({ type: z.literal('user'), userId: z.string().min(1).max(128) })
  .strict()
const workspaceRoleSubjectSchema = z
  .object({
    type: z.literal('workspace_role'),
    minimumRole: z.enum(['read', 'write', 'admin']),
  })
  .strict()
const accessControlGroupSubjectSchema = z
  .object({
    type: z.literal('access_control_group'),
    accessControlGroupId: z.string().min(1).max(128),
  })
  .strict()
const workflowSubjectSchema = z
  .object({ type: z.literal('workflow'), workflowId: z.string().min(1).max(128) })
  .strict()
const externalIdentitySubjectSchema = z
  .object({
    type: z.literal('external_identity'),
    provider: z.string().min(1).max(128),
    tenantId: z.string().min(1).max(256),
    subjectId: z.string().min(1).max(256),
  })
  .strict()

export const resourcePolicySubjectSchema = z.discriminatedUnion('type', [
  userSubjectSchema,
  workspaceRoleSubjectSchema,
  accessControlGroupSubjectSchema,
  workflowSubjectSchema,
  externalIdentitySubjectSchema,
])

export type ResourcePolicySubject = z.output<typeof resourcePolicySubjectSchema>

export const resourcePolicyGrantSchema = z
  .object({
    id: z.string().min(1).max(128),
    subject: resourcePolicySubjectSchema,
    actions: z.array(z.enum(RESOURCE_POLICY_ACTIONS)).min(1).max(RESOURCE_POLICY_ACTIONS.length),
  })
  .strict()

export const resourcePolicyDocumentSchema = z
  .object({
    version: z.literal(RESOURCE_POLICY_VERSION),
    resource: z
      .object({
        type: z.enum(RESOURCE_POLICY_RESOURCE_TYPES),
        id: z.string().min(1).max(128),
      })
      .strict(),
    grants: z.array(resourcePolicyGrantSchema).max(100),
  })
  .strict()
  .superRefine((document, ctx) => {
    const resourceActions: ReadonlySet<ResourcePolicyAction> = new Set(
      RESOURCE_POLICY_ACTIONS_BY_RESOURCE[document.resource.type]
    )
    const ids = new Set<string>()
    const subjects = new Set<string>()
    for (const [index, grant] of document.grants.entries()) {
      if (ids.has(grant.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['grants', index, 'id'],
          message: 'Resource policy grant IDs must be unique',
        })
      }
      ids.add(grant.id)
      const subjectKey = JSON.stringify(grant.subject)
      if (subjects.has(subjectKey)) {
        ctx.addIssue({
          code: 'custom',
          path: ['grants', index, 'subject'],
          message: 'A resource policy subject can only appear once',
        })
      }
      subjects.add(subjectKey)
      if (new Set(grant.actions).size !== grant.actions.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['grants', index, 'actions'],
          message: 'Resource policy actions must be unique within a grant',
        })
      }
      for (const [actionIndex, action] of grant.actions.entries()) {
        if (!resourceActions.has(action)) {
          ctx.addIssue({
            code: 'custom',
            path: ['grants', index, 'actions', actionIndex],
            message: 'Resource policy action does not apply to this resource type',
          })
        }
      }
    }
  })

export type ResourcePolicyGrant = z.output<typeof resourcePolicyGrantSchema>
export type ResourcePolicyDocument = z.output<typeof resourcePolicyDocumentSchema>

export function parseResourcePolicyDocument(
  value: unknown,
  expected: { type: ResourcePolicyResourceType; id: string }
): ResourcePolicyDocument {
  const document = resourcePolicyDocumentSchema.parse(value)
  if (document.resource.type !== expected.type || document.resource.id !== expected.id) {
    throw new Error('Resource policy document does not match its canonical resource')
  }
  return document
}
