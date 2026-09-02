import type { WorkflowExecutionAuthority } from '@sim/auth/principal'
import { z } from 'zod'
import {
  CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT,
  CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT,
} from '@/lib/credential-groups/workflow-access-limits'
import {
  CREDENTIAL_GROUP_ACTOR_OWNS_CREDENTIAL_CONDITION_KEY,
  CREDENTIAL_GROUP_OPTION_ID_CONDITION_KEY,
} from '@/lib/resource-policies/conditions'
import { WORKFLOW_MODE_RESOURCE_POLICY_CONDITION_KEY } from '@/lib/resource-policies/conditions/workflow-mode'
import {
  evaluateResourcePolicy,
  type ResourcePolicyDecision,
} from '@/lib/resource-policies/evaluator'
import {
  credentialGroupActorResourcePolicyPrincipalSchema,
  knowledgeConnectorResourcePolicyPrincipalSchema,
  workflowResourcePolicyPrincipalSchema,
} from '@/lib/resource-policies/principals'
import {
  CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION,
  type ResourcePolicyBindingFor,
} from '@/lib/resource-policies/registry'
import type { ResourcePolicyCodec } from '@/lib/resource-policies/types'

export const CREDENTIAL_GROUP_WORKFLOW_ACCESS_SID = 'WorkflowCredentialAccess'
export const CREDENTIAL_GROUP_ACTOR_ACCESS_SID = 'CredentialGroupActorCredentialAccess'
/**
 * One statement per credential option, `KnowledgeConnectorCredentialAccess:<optionId>`,
 * naming the knowledge connectors that crawl with that option's credentials. The
 * option lives in the SID so statements stay addressable, and in the condition so
 * the evaluator enforces it.
 */
export const CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX =
  'KnowledgeConnectorCredentialAccess:'
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

function knowledgeConnectorAccessSid(credentialGroupOptionId: string): string {
  return `${CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX}${credentialGroupOptionId}`
}

const credentialGroupKnowledgeConnectorAccessStatementSchema = z
  .object({
    sid: z
      .string()
      .startsWith(CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX)
      .refine(
        (sid) =>
          canonicalIdSchema.safeParse(
            sid.slice(CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX.length)
          ).success,
        'Knowledge connector access SID must name a canonical credential option'
      ),
    effect: z.literal('allow'),
    actions: z.tuple([z.literal(CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION)]),
    principals: z
      .array(knowledgeConnectorResourcePolicyPrincipalSchema)
      .min(1)
      .max(CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT)
      .superRefine((principals, ctx) => {
        for (let index = 1; index < principals.length; index += 1) {
          const previous = principals[index - 1].connectorId
          const current = principals[index].connectorId
          if (current === previous) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'connectorId'],
              message: `Credential Group access repeats knowledge connector ${current}`,
            })
          } else if (current < previous) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'connectorId'],
              message: 'Credential Group knowledge connector access principals must be sorted',
            })
          }
        }
      }),
    condition: z
      .object({
        StringEquals: z
          .object({
            [CREDENTIAL_GROUP_OPTION_ID_CONDITION_KEY]: canonicalIdSchema,
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((statement, ctx) => {
    const optionId = statement.condition.StringEquals[CREDENTIAL_GROUP_OPTION_ID_CONDITION_KEY]
    if (statement.sid !== knowledgeConnectorAccessSid(optionId)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sid'],
        message: 'Knowledge connector access SID must name the option in its condition',
      })
    }
  })

const credentialGroupAccessStatementSchema = z.union([
  credentialGroupActorAccessStatementSchema,
  credentialGroupWorkflowAccessStatementSchema,
  credentialGroupKnowledgeConnectorAccessStatementSchema,
])

/**
 * Statement order is fixed so the document has one canonical form: the actor
 * statement, then at most one workflow statement, then knowledge connector
 * statements sorted by option. Anything else is rejected rather than normalised.
 */
export const credentialGroupWorkflowAccessPolicySchema = z
  .object({
    version: z.literal(1),
    resource: z
      .object({
        type: z.literal('credential_group'),
        id: canonicalIdSchema,
      })
      .strict(),
    statements: z
      .array(credentialGroupAccessStatementSchema)
      .min(1)
      .superRefine((statements, ctx) => {
        if (statements[0].sid !== CREDENTIAL_GROUP_ACTOR_ACCESS_SID) {
          ctx.addIssue({
            code: 'custom',
            path: [0, 'sid'],
            message: 'Credential Group access must begin with the actor statement',
          })
        }
        let index = 1
        if (statements[index]?.sid === CREDENTIAL_GROUP_WORKFLOW_ACCESS_SID) index += 1
        let previousOptionId: string | undefined
        for (; index < statements.length; index += 1) {
          const sid = statements[index].sid
          if (!sid.startsWith(CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX)) {
            ctx.addIssue({
              code: 'custom',
              path: [index, 'sid'],
              message:
                'Credential Group access statements must be ordered actor, workflow, then knowledge connectors',
            })
            continue
          }
          const optionId = sid.slice(CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX.length)
          if (previousOptionId !== undefined) {
            if (optionId === previousOptionId) {
              ctx.addIssue({
                code: 'custom',
                path: [index, 'sid'],
                message: `Credential Group access repeats credential option ${optionId}`,
              })
            } else if (optionId < previousOptionId) {
              ctx.addIssue({
                code: 'custom',
                path: [index, 'sid'],
                message: 'Credential Group knowledge connector access statements must be sorted',
              })
            }
          }
          previousOptionId = optionId
        }
      }),
  })
  .strict()

export type CredentialGroupWorkflowAccessPolicy = z.output<
  typeof credentialGroupWorkflowAccessPolicySchema
>

type CredentialGroupWorkflowAccessStatement = z.output<
  typeof credentialGroupWorkflowAccessStatementSchema
>
type CredentialGroupKnowledgeConnectorAccessStatement = z.output<
  typeof credentialGroupKnowledgeConnectorAccessStatementSchema
>

/** The knowledge connectors one credential option backs. */
export interface CredentialGroupKnowledgeConnectorAccess {
  credentialGroupOptionId: string
  connectorIds: string[]
}

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

function requireCanonicalId(value: string, label: string): void {
  if (!value.trim() || value !== value.trim() || value.length > 128) {
    throw new Error(`Credential Group access ${label} must be canonical non-empty strings`)
  }
}

function requireAllowedWorkflowIds(allowedWorkflowIds: readonly string[]): string[] {
  if (allowedWorkflowIds.length > CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT) {
    throw new Error(
      `Credential Group access cannot allow more than ${CREDENTIAL_GROUP_WORKFLOW_ACCESS_LIMIT} workflows`
    )
  }

  const workflowIds = new Set<string>()
  for (const workflowId of allowedWorkflowIds) {
    requireCanonicalId(workflowId, 'workflow IDs')
    if (workflowIds.has(workflowId)) {
      throw new Error(`Credential Group access repeats workflow ${workflowId}`)
    }
    workflowIds.add(workflowId)
  }
  return [...workflowIds].sort()
}

/**
 * Normalises knowledge connector access into its canonical form: options sorted,
 * connectors sorted and unique, empty options dropped, and each connector bound
 * to one option only — a connector crawls with exactly one credential slot.
 */
function requireKnowledgeConnectorAccess(
  entries: readonly CredentialGroupKnowledgeConnectorAccess[]
): CredentialGroupKnowledgeConnectorAccess[] {
  const byOption = new Map<string, Set<string>>()
  const boundConnectors = new Set<string>()
  for (const entry of entries) {
    requireCanonicalId(entry.credentialGroupOptionId, 'credential option IDs')
    if (byOption.has(entry.credentialGroupOptionId)) {
      throw new Error(
        `Credential Group access repeats credential option ${entry.credentialGroupOptionId}`
      )
    }
    const connectorIds = new Set<string>()
    for (const connectorId of entry.connectorIds) {
      requireCanonicalId(connectorId, 'knowledge connector IDs')
      if (connectorIds.has(connectorId)) {
        throw new Error(`Credential Group access repeats knowledge connector ${connectorId}`)
      }
      if (boundConnectors.has(connectorId)) {
        throw new Error(
          `Credential Group access binds knowledge connector ${connectorId} to more than one credential option`
        )
      }
      connectorIds.add(connectorId)
      boundConnectors.add(connectorId)
    }
    if (connectorIds.size > CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT) {
      throw new Error(
        `Credential Group access cannot allow more than ${CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_LIMIT} knowledge connectors per credential option`
      )
    }
    if (connectorIds.size > 0) byOption.set(entry.credentialGroupOptionId, connectorIds)
  }
  return [...byOption.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([credentialGroupOptionId, connectorIds]) => ({
      credentialGroupOptionId,
      connectorIds: [...connectorIds].sort(),
    }))
}

export function compileCredentialGroupWorkflowAccessPolicy(input: {
  credentialGroupId: string
  allowedWorkflowIds: readonly string[]
  knowledgeConnectorAccess?: readonly CredentialGroupKnowledgeConnectorAccess[]
}): CredentialGroupWorkflowAccessPolicy {
  const allowedWorkflowIds = requireAllowedWorkflowIds(input.allowedWorkflowIds)
  const knowledgeConnectorAccess = requireKnowledgeConnectorAccess(
    input.knowledgeConnectorAccess ?? []
  )
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
  const workflowStatements =
    allowedWorkflowIds.length === 0
      ? []
      : [
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
        ]
  const knowledgeConnectorStatements = knowledgeConnectorAccess.map((entry) => ({
    sid: knowledgeConnectorAccessSid(entry.credentialGroupOptionId),
    effect: 'allow',
    actions: [CREDENTIAL_GROUP_CREDENTIAL_USE_ACTION],
    principals: entry.connectorIds.map((connectorId) => ({
      type: 'knowledge_connector' as const,
      connectorId,
    })),
    condition: {
      StringEquals: {
        [CREDENTIAL_GROUP_OPTION_ID_CONDITION_KEY]: entry.credentialGroupOptionId,
      },
    },
  }))
  return credentialGroupWorkflowAccessPolicyCodec.parse(
    {
      version: 1,
      resource: { type: 'credential_group', id: input.credentialGroupId },
      statements: [actorStatement, ...workflowStatements, ...knowledgeConnectorStatements],
    },
    { type: 'credential_group', id: input.credentialGroupId }
  )
}

function parseCanonicalDocument(
  document: unknown,
  credentialGroupId: string
): CredentialGroupWorkflowAccessPolicy {
  return credentialGroupWorkflowAccessPolicyCodec.parse(document, {
    type: 'credential_group',
    id: credentialGroupId,
  })
}

export function decodeCredentialGroupWorkflowAccessPolicy(
  document: unknown,
  credentialGroupId: string
): string[] {
  const canonical = parseCanonicalDocument(document, credentialGroupId)
  const workflowStatement = canonical.statements.find(
    (statement): statement is CredentialGroupWorkflowAccessStatement =>
      statement.sid === CREDENTIAL_GROUP_WORKFLOW_ACCESS_SID
  )
  return workflowStatement
    ? workflowStatement.principals.map((principal) => principal.workflowId)
    : []
}

export function decodeCredentialGroupKnowledgeConnectorAccess(
  document: unknown,
  credentialGroupId: string
): CredentialGroupKnowledgeConnectorAccess[] {
  const canonical = parseCanonicalDocument(document, credentialGroupId)
  return canonical.statements
    .filter((statement): statement is CredentialGroupKnowledgeConnectorAccessStatement =>
      statement.sid.startsWith(CREDENTIAL_GROUP_KNOWLEDGE_CONNECTOR_ACCESS_SID_PREFIX)
    )
    .map((statement) => ({
      credentialGroupOptionId:
        statement.condition.StringEquals[CREDENTIAL_GROUP_OPTION_ID_CONDITION_KEY],
      connectorIds: statement.principals.map((principal) => principal.connectorId),
    }))
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
  const knowledgeConnectorAccess = decodeCredentialGroupKnowledgeConnectorAccess(
    input.document,
    input.credentialGroupId
  )
  if (
    input.revision !== 1 ||
    allowedWorkflowIds.length !== 0 ||
    knowledgeConnectorAccess.length !== 0
  ) {
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
  const document = parseCanonicalDocument(input.document, input.credentialGroupId)
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

/**
 * Decides whether a knowledge connector may use a credential collected under
 * one option. There is no actor and no workflow: the connector is the principal
 * and the option is the only condition, so the actor and workflow statements can
 * never match here.
 */
export function evaluateCredentialGroupKnowledgeConnectorAccess(input: {
  document: CredentialGroupWorkflowAccessPolicy
  credentialGroupId: string
  connectorId: string
  credentialGroupOptionId: string
  resourcePolicy: ResourcePolicyBindingFor<'credential_group'>
}): ResourcePolicyDecision {
  const document = parseCanonicalDocument(input.document, input.credentialGroupId)
  return evaluateResourcePolicy({
    document,
    action: input.resourcePolicy.action,
    facts: {
      currentKnowledgeConnector: { connectorId: input.connectorId },
      credentialGroupOptionId: input.credentialGroupOptionId,
    },
  })
}
