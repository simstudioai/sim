import type { WorkflowExecutionAuthority } from '@sim/auth/principal'
import { z } from 'zod'
import { CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT } from '@/lib/credential-groups/workflow-access-limits'
import { CREDENTIAL_GROUP_ACTOR_OWNS_CREDENTIAL_CONDITION_KEY } from '@/lib/resource-policies/conditions'
import { WORKFLOW_MODE_RESOURCE_POLICY_CONDITION_KEY } from '@/lib/resource-policies/conditions/workflow-mode'
import {
  evaluateResourcePolicy,
  type ResourcePolicyDecision,
} from '@/lib/resource-policies/evaluator'
import {
  credentialGroupActorResourcePolicyPrincipalSchema,
  workflowResourcePolicyPrincipalSchema,
} from '@/lib/resource-policies/principals'
import {
  CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
  type ResourcePolicyBindingFor,
} from '@/lib/resource-policies/registry'
import type { ResourcePolicyCodec } from '@/lib/resource-policies/types'

export const CREDENTIAL_GROUP_WORKFLOW_ACCESS_SID = 'WorkflowCredentialAccess'
export const CREDENTIAL_GROUP_ACTOR_ACCESS_SID = 'CredentialGroupActorCredentialAccess'
export { CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION }
export const CREDENTIAL_GROUP_WORKFLOW_MODE_CONDITION_KEY =
  WORKFLOW_MODE_RESOURCE_POLICY_CONDITION_KEY

const canonicalIdSchema = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), 'Resource policy IDs must be canonical')

const credentialGroupActorAccessStatementSchema = z
  .object({
    sid: z.literal(CREDENTIAL_GROUP_ACTOR_ACCESS_SID),
    effect: z.literal('allow'),
    actions: z.tuple([z.literal(CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION)]),
    principals: z.tuple([credentialGroupActorResourcePolicyPrincipalSchema]),
    condition: z
      .object({
        Bool: z
          .object({
            [CREDENTIAL_GROUP_ACTOR_OWNS_CREDENTIAL_CONDITION_KEY]: z.literal(true),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

const credentialGroupWorkflowAccessStatementSchema = z
  .object({
    sid: z.literal(CREDENTIAL_GROUP_WORKFLOW_ACCESS_SID),
    effect: z.literal('allow'),
    actions: z.tuple([z.literal(CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION)]),
    principals: z
      .array(workflowResourcePolicyPrincipalSchema)
      .min(1)
      .max(CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT)
      .superRefine((principals, ctx) => {
        for (let index = 1; index < principals.length; index += 1) {
          const previous = principals[index - 1].workflowId
          const current = principals[index].workflowId
          if (current === previous) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'workflowId'],
              message: `Credential Group access repeats workflow ${current}`,
            })
          } else if (current < previous) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'workflowId'],
              message: 'Credential Group workflow access principals must be sorted',
            })
          }
        }
      }),
    condition: z
      .object({
        StringEquals: z
          .object({
            [CREDENTIAL_GROUP_WORKFLOW_MODE_CONDITION_KEY]: z.literal('deployment'),
          })
          .strict(),
      })
      .strict(),
  })
  .strict()

export const credentialGroupWorkflowAccessPolicySchema = z
  .object({
    version: z.literal(1),
    resource: z
      .object({
        type: z.literal('credential_group'),
        id: canonicalIdSchema,
      })
      .strict(),
    statements: z.union([
      z.tuple([credentialGroupActorAccessStatementSchema]),
      z.tuple([
        credentialGroupActorAccessStatementSchema,
        credentialGroupWorkflowAccessStatementSchema,
      ]),
    ]),
  })
  .strict()

export type CredentialGroupWorkflowAccessPolicy = z.output<
  typeof credentialGroupWorkflowAccessPolicySchema
>

export const credentialGroupWorkflowAccessPolicyCodec = {
  resourceType: 'credential_group',
  parse(
    value: unknown,
    expected: { type: 'credential_group'; id: string }
  ): CredentialGroupWorkflowAccessPolicy {
    const document = credentialGroupWorkflowAccessPolicySchema.parse(value)
    if (document.resource.type !== expected.type || document.resource.id !== expected.id) {
      throw new Error('Resource policy document does not match its canonical resource')
    }
    return document
  },
} as const satisfies ResourcePolicyCodec<'credential_group', CredentialGroupWorkflowAccessPolicy>

function requireAllowedWorkflowIds(allowedWorkflowIds: readonly string[]): string[] {
  if (allowedWorkflowIds.length > CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT) {
    throw new Error(
      `Credential Group access cannot allow more than ${CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT} workflows`
    )
  }

  const workflowIds = new Set<string>()
  for (const workflowId of allowedWorkflowIds) {
    if (!workflowId.trim() || workflowId !== workflowId.trim() || workflowId.length > 128) {
      throw new Error('Credential Group access workflow IDs must be canonical non-empty strings')
    }
    if (workflowIds.has(workflowId)) {
      throw new Error(`Credential Group access repeats workflow ${workflowId}`)
    }
    workflowIds.add(workflowId)
  }
  return [...workflowIds].sort()
}

export function compileCredentialGroupWorkflowAccessPolicy(input: {
  credentialGroupId: string
  allowedWorkflowIds: readonly string[]
}): CredentialGroupWorkflowAccessPolicy {
  const allowedWorkflowIds = requireAllowedWorkflowIds(input.allowedWorkflowIds)
  const actorStatement = {
    sid: CREDENTIAL_GROUP_ACTOR_ACCESS_SID,
    effect: 'allow',
    actions: [CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION],
    principals: [{ type: 'credential_group_actor' }],
    condition: {
      Bool: {
        [CREDENTIAL_GROUP_ACTOR_OWNS_CREDENTIAL_CONDITION_KEY]: true,
      },
    },
  } as const
  return credentialGroupWorkflowAccessPolicyCodec.parse(
    {
      version: 1,
      resource: { type: 'credential_group', id: input.credentialGroupId },
      statements:
        allowedWorkflowIds.length === 0
          ? [actorStatement]
          : [
              actorStatement,
              {
                sid: CREDENTIAL_GROUP_WORKFLOW_ACCESS_SID,
                effect: 'allow',
                actions: [CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION],
                principals: allowedWorkflowIds.map((workflowId) => ({
                  type: 'workflow' as const,
                  workflowId,
                })),
                condition: {
                  StringEquals: {
                    [CREDENTIAL_GROUP_WORKFLOW_MODE_CONDITION_KEY]: 'deployment',
                  },
                },
              },
            ],
    },
    { type: 'credential_group', id: input.credentialGroupId }
  )
}

export function decodeCredentialGroupWorkflowAccessPolicy(
  document: unknown,
  credentialGroupId: string
): string[] {
  const canonical = credentialGroupWorkflowAccessPolicyCodec.parse(document, {
    type: 'credential_group',
    id: credentialGroupId,
  })
  return canonical.statements.length === 1
    ? []
    : canonical.statements[1].principals.map((principal) => principal.workflowId)
}

export function requireDefaultCredentialGroupWorkflowAccessPolicy(input: {
  revision: number
  document: CredentialGroupWorkflowAccessPolicy
  credentialGroupId: string
}): void {
  const allowedWorkflowIds = decodeCredentialGroupWorkflowAccessPolicy(
    input.document,
    input.credentialGroupId
  )
  if (input.revision !== 1 || allowedWorkflowIds.length !== 0) {
    throw new Error('New resource was bound to a non-default resource policy')
  }
}

export function evaluateCredentialGroupWorkflowAccess(input: {
  document: CredentialGroupWorkflowAccessPolicy
  credentialGroupId: string
  selectedEnrollmentId: string
  actorEnrollmentId?: string
  currentWorkflow: WorkflowExecutionAuthority
  resourcePolicy: ResourcePolicyBindingFor<'credential_group'>
}): ResourcePolicyDecision {
  const document = credentialGroupWorkflowAccessPolicyCodec.parse(input.document, {
    type: 'credential_group',
    id: input.credentialGroupId,
  })
  return evaluateResourcePolicy({
    document,
    action: input.resourcePolicy.action,
    facts: {
      ...(input.actorEnrollmentId
        ? { credentialGroupActorEnrollmentId: input.actorEnrollmentId }
        : {}),
      credentialGroupCredentialEnrollmentId: input.selectedEnrollmentId,
      currentWorkflow: input.currentWorkflow,
    },
  })
}
