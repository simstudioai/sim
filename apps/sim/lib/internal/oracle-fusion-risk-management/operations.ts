import { z } from 'zod'
import {
  type OracleFusionResolvedCredential,
  requestOracleFusionEmpty,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import type { OracleFusionResourceAddress } from '@/lib/internal/oracle-fusion/paths'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import { oracleFusionExactInteger } from '@/lib/internal/oracle-fusion/request-body'
import {
  parseRiskBody,
  RISK_MAX_OFFSET,
  RiskInputError,
  RiskResponseError,
  riskIdentifierSchema,
  riskKeySchema,
  riskPagingSchema,
  riskResourceSchemas,
  riskWriteSchemas,
} from '@/lib/internal/oracle-fusion-risk-management/schema'
import {
  RISK_OPERATIONS,
  type RiskOperation,
  type RiskOperationDefinition,
  type RiskResource,
} from '@/tools/oracle_fusion_risk_management/types'
import type { ToolResponse } from '@/tools/types'

interface RiskResourceDefinition {
  collection: string
  param: string
  idField: string
  opaque: boolean
  numeric: readonly string[]
}

export const riskResources = {
  process: {
    collection: 'frcProcesses',
    param: 'processId',
    idField: 'ProcessId',
    opaque: false,
    numeric: ['processId'],
  },
  risk: {
    collection: 'frcRisks',
    param: 'riskId',
    idField: 'RiskId',
    opaque: false,
    numeric: ['riskId'],
  },
  control: {
    collection: 'frcControls',
    param: 'controlId',
    idField: 'ControlId',
    opaque: false,
    numeric: ['controlId'],
  },
  issue: {
    collection: 'frcIssues',
    param: 'issueId',
    idField: 'IssueId',
    opaque: false,
    numeric: ['issueId'],
  },
  process_comment: {
    collection: 'frcProcesses/{processId}/child/comments',
    param: 'commentId',
    idField: 'Id',
    opaque: false,
    numeric: ['processId', 'commentId'],
  },
  process_perspective: {
    collection: 'frcProcesses/{processId}/child/perspectives',
    param: 'perspectiveKey',
    idField: 'perspectivesUniqID',
    opaque: true,
    numeric: ['processId'],
  },
  risk_comment: {
    collection: 'frcRisks/{riskId}/child/comments',
    param: 'commentId',
    idField: 'Id',
    opaque: false,
    numeric: ['riskId', 'commentId'],
  },
  risk_perspective: {
    collection: 'frcRisks/{riskId}/child/perspectives',
    param: 'perspectiveKey',
    idField: 'perspectivesUniqID',
    opaque: true,
    numeric: ['riskId'],
  },
  control_comment: {
    collection: 'frcControls/{controlId}/child/comments',
    param: 'commentId',
    idField: 'Id',
    opaque: false,
    numeric: ['controlId', 'commentId'],
  },
  control_perspective: {
    collection: 'frcControls/{controlId}/child/perspectives',
    param: 'perspectiveKey',
    idField: 'perspectivesUniqID',
    opaque: true,
    numeric: ['controlId'],
  },
  process_risk: {
    collection: 'frcProcesses/{processId}/child/relatedRisks',
    param: 'relationshipKey',
    idField: 'relatedRisksUniqID',
    opaque: true,
    numeric: ['processId'],
  },
  risk_process: {
    collection: 'frcRisks/{riskId}/child/relatedProcesses',
    param: 'relationshipKey',
    idField: 'relatedProcessesUniqID',
    opaque: true,
    numeric: ['riskId'],
  },
  risk_control: {
    collection: 'frcRisks/{riskId}/child/relatedControls',
    param: 'relationshipKey',
    idField: 'relatedControlsUniqID',
    opaque: true,
    numeric: ['riskId'],
  },
  control_risk: {
    collection: 'frcControls/{controlId}/child/relatedRisks',
    param: 'relationshipKey',
    idField: 'relatedRisksUniqID',
    opaque: true,
    numeric: ['controlId'],
  },
  process_action_item: {
    collection: 'frcProcesses/{processId}/child/actionItems',
    param: 'actionItemId',
    idField: 'ActionId',
    opaque: false,
    numeric: ['processId', 'actionItemId'],
  },
  process_assessment_result: {
    collection: 'frcProcessAssessmentResults',
    param: 'processAssessmentResultId',
    idField: 'ResultId',
    opaque: false,
    numeric: ['processAssessmentResultId'],
  },
  risk_assessment_result: {
    collection: 'frcRiskAssessmentResults',
    param: 'riskAssessmentResultId',
    idField: 'ResultId',
    opaque: false,
    numeric: ['riskAssessmentResultId'],
  },
  control_assessment_result: {
    collection: 'frcControlAssessmentResults',
    param: 'controlAssessmentResultId',
    idField: 'ResultId',
    opaque: false,
    numeric: ['controlAssessmentResultId'],
  },
  control_assertion: {
    collection: 'frcControls/{controlId}/child/assertions',
    param: 'assertionKey',
    idField: 'assertionsUniqID',
    opaque: true,
    numeric: ['controlId'],
  },
  control_test_plan: {
    collection: 'frcControls/{controlId}/child/testPlans',
    param: 'testPlanId',
    idField: 'TestPlanId',
    opaque: false,
    numeric: ['controlId', 'testPlanId'],
  },
  test_plan_step: {
    collection: 'frcControls/{controlId}/child/testPlans/{testPlanId}/child/steps',
    param: 'stepId',
    idField: 'StepId',
    opaque: false,
    numeric: ['controlId', 'testPlanId', 'stepId'],
  },
  test_plan_activity: {
    collection: 'frcControls/{controlId}/child/testPlans/{testPlanId}/child/planActivity',
    param: 'activityKey',
    idField: 'planActivityUniqID',
    opaque: true,
    numeric: ['controlId', 'testPlanId'],
  },
  advanced_control: {
    collection: 'advancedControls',
    param: 'advancedControlId',
    idField: 'Id',
    opaque: false,
    numeric: ['advancedControlId'],
  },
  advanced_control_comment: {
    collection: 'advancedControls/{advancedControlId}/child/comments',
    param: 'commentKey',
    idField: 'Id',
    opaque: true,
    numeric: ['advancedControlId'],
  },
  advanced_control_perspective: {
    collection: 'advancedControls/{advancedControlId}/child/perspectives',
    param: 'perspectiveKey',
    idField: 'perspectivesUniqID',
    opaque: true,
    numeric: ['advancedControlId'],
  },
  incident: {
    collection: 'advancedControls/{advancedControlId}/child/incidents',
    param: 'incidentKey',
    idField: 'Id',
    opaque: true,
    numeric: ['advancedControlId'],
  },
  incident_comment: {
    collection: 'advancedControls/{advancedControlId}/child/incidents/{incidentKey}/child/comments',
    param: 'commentKey',
    idField: 'Id',
    opaque: true,
    numeric: ['advancedControlId'],
  },
  incident_attribute: {
    collection:
      'advancedControls/{advancedControlId}/child/incidents/{incidentKey}/child/dynamicAttributes',
    param: 'attributeKey',
    idField: 'Id',
    opaque: true,
    numeric: ['advancedControlId'],
  },
  incident_perspective: {
    collection:
      'advancedControls/{advancedControlId}/child/incidents/{incidentKey}/child/perspectives',
    param: 'treeId',
    idField: 'TreeId',
    opaque: false,
    numeric: ['advancedControlId', 'treeId'],
  },
  open_incident: {
    collection: 'openIncidents',
    param: 'openIncidentKey',
    idField: 'ResultId',
    opaque: true,
    numeric: [],
  },
  advanced_control_job: {
    collection: 'advancedControlsJobs',
    param: 'jobId',
    idField: 'Id',
    opaque: false,
    numeric: ['jobId'],
  },
  simulation_result: {
    collection: 'advancedControlsRolesProvisioning',
    param: 'simulationResultKey',
    idField: 'advancedControlsRolesProvisioningUniqID',
    opaque: true,
    numeric: [],
  },
  assignment_group: {
    collection: 'userAssignmentGroups',
    param: 'groupKey',
    idField: 'GroupId',
    opaque: true,
    numeric: [],
  },
  group_member: {
    collection: 'userAssignmentGroups/{groupKey}/child/members',
    param: 'memberId',
    idField: 'Id',
    opaque: false,
    numeric: ['memberId'],
  },
  group_security_assignment: {
    collection: 'userAssignmentGroups/{groupKey}/child/securityAssignments',
    param: 'securityAssignmentId',
    idField: 'Id',
    opaque: false,
    numeric: ['securityAssignmentId'],
  },
  group_eligible_user: {
    collection: 'userAssignmentGroups/{groupKey}/child/eligibleUsers',
    param: 'userKey',
    idField: 'UserGuid',
    opaque: true,
    numeric: [],
  },
  securable_type: {
    collection: 'userAssignmentSecurableTypes',
    param: 'securableTypeKey',
    idField: 'SecurableType',
    opaque: true,
    numeric: [],
  },
  securable_role_type: {
    collection: 'userAssignmentSecurableTypes/{securableTypeKey}/child/roleTypes',
    param: 'roleTypeKey',
    idField: 'RoleType',
    opaque: true,
    numeric: [],
  },
  securable_eligible_user: {
    collection: 'userAssignmentSecurableTypes/{securableTypeKey}/child/eligibleUsers',
    param: 'userKey',
    idField: 'UserGuid',
    opaque: true,
    numeric: [],
  },
} as const satisfies Record<RiskResource, RiskResourceDefinition>

function identifier(resource: RiskResource, name: string, value: unknown): string {
  const definition: RiskResourceDefinition = riskResources[resource]
  return definition.numeric.includes(name)
    ? riskIdentifierSchema.parse(value)
    : riskKeySchema.parse(value)
}

function collectionAddress(
  resource: RiskResource,
  params: Record<string, unknown>
): OracleFusionResourceAddress {
  return {
    family: 'fscm',
    relativePath: riskResources[resource].collection.replace(/\{(\w+)\}/g, (_, name: string) =>
      encodeOracleFusionPathSegment(identifier(resource, name, params[name]))
    ),
  }
}

function detailAddress(
  resource: RiskResource,
  params: Record<string, unknown>
): OracleFusionResourceAddress {
  const definition = riskResources[resource]
  const address = collectionAddress(resource, params)
  const key = identifier(resource, definition.param, params[definition.param])
  return {
    ...address,
    relativePath: `${address.relativePath}/${encodeOracleFusionPathSegment(key)}`,
  }
}

function projectResource(
  resource: RiskResource,
  raw: unknown,
  credential: OracleFusionResolvedCredential,
  collection: OracleFusionResourceAddress
): Record<string, unknown> {
  try {
    const key = riskResources[resource].opaque
      ? extractOracleFusionOpaqueKey(raw, credential.instanceUrl, collection)
      : undefined
    const record = riskResourceSchemas[resource].parse(raw)
    return key === undefined ? record : { key, ...record }
  } catch {
    throw new RiskResponseError('Oracle Fusion returned an invalid Risk Management record')
  }
}

/** One bounded page; transport byte caps and retries belong to the existing Fusion client. */
export async function listRiskResource(
  resource: RiskResource,
  credential: OracleFusionResolvedCredential,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  signal?.throwIfAborted()
  const paging = riskPagingSchema.parse(params)
  const address = collectionAddress(resource, params)
  const finder =
    resource === 'simulation_result'
      ? `getUserProvisioningAnalysisIncidents;requestId=${riskIdentifierSchema.parse(params.requestId)}`
      : undefined
  const raw = await requestOracleFusionJson(
    credential,
    {
      method: 'GET',
      address,
      query: {
        ...paging,
        finder,
        fields: Object.keys(riskResourceSchemas[resource].shape).join(','),
      },
    },
    signal
  )
  try {
    const page = parseOracleFusionCollection(
      raw,
      (item) => projectResource(resource, item, credential, address),
      {
        expectedOffset: paging.offset,
        maxItems: paging.limit,
      }
    )
    if (page.hasMore && page.nextOffset > RISK_MAX_OFFSET) {
      throw new RiskResponseError('Oracle Fusion pagination exceeds the supported offset')
    }
    const { nextOffset, ...result } = page
    return { ...result, ...(page.hasMore ? { nextOffset } : {}) }
  } catch (error) {
    if (error instanceof RiskResponseError) throw error
    throw new RiskResponseError('Oracle Fusion returned an invalid collection page')
  }
}

export async function getRiskResource(
  resource: RiskResource,
  credential: OracleFusionResolvedCredential,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const address = detailAddress(resource, params)
  const raw = await requestOracleFusionJson(
    credential,
    {
      method: 'GET',
      address,
      query: { fields: Object.keys(riskResourceSchemas[resource].shape).join(',') },
    },
    signal
  )
  return verifyResource(resource, raw, credential, params, address)
}

function verifyResource(
  resource: RiskResource,
  raw: unknown,
  credential: OracleFusionResolvedCredential,
  params: Record<string, unknown>,
  expectedAddress?: OracleFusionResourceAddress
) {
  const collection = collectionAddress(resource, params)
  const record = projectResource(resource, raw, credential, collection)
  const definition = riskResources[resource]
  const resultId = record[definition.opaque ? 'key' : definition.idField]
  try {
    if (typeof resultId !== 'string') throw new Error('Missing identifier')
    const address = expectedAddress ?? {
      ...collection,
      relativePath: `${collection.relativePath}/${encodeOracleFusionPathSegment(resultId)}`,
    }
    validateOracleFusionSelfLink(raw, credential.instanceUrl, address)
    if (
      expectedAddress &&
      resultId !== identifier(resource, definition.param, params[definition.param])
    ) {
      throw new Error('Different identifier')
    }
  } catch {
    throw new RiskResponseError('Oracle Fusion returned a different resource than requested')
  }
  return record
}

const simulationInfoSchema = z
  .record(z.string().min(1).max(256), z.array(z.string().min(1).max(1024)).max(100))
  .refine(
    (value) => Object.keys(value).length > 0 && Object.keys(value).length <= 100,
    'Supply 1-100 role codes'
  )
const stringActionSchema = z.object({ result: z.string().min(1) })

function parseInput(definition: RiskOperationDefinition, input: unknown) {
  const pagingShape =
    definition.resource === 'simulation_result'
      ? riskPagingSchema.omit({ q: true }).shape
      : riskPagingSchema.shape
  const shape: Record<string, z.ZodTypeAny> = {
    oauthCredential: z.string().min(1),
    accessToken: z.string().min(1),
    instanceUrl: z.string().min(1),
    ...(definition.kind === 'list' ? pagingShape : {}),
    ...(definition.bodyDescription ? { body: z.unknown() } : {}),
  }
  for (const name of definition.params) {
    shape[name] =
      name === 'requestId'
        ? riskIdentifierSchema
        : name === 'userName'
          ? z.string().trim().min(1).max(256)
          : name === 'provisioningInfo'
            ? z.unknown()
            : z.unknown().transform((value) => identifier(definition.resource, name, value))
  }
  return z.object(shape).strict().parse(input)
}

const parentBodyBindings: Partial<Record<RiskOperation, Record<string, string>>> = {
  oracle_fusion_risk_management_create_group_member: { GroupId: 'groupKey' },
  oracle_fusion_risk_management_create_group_security_assignment: { SecurableId: 'groupKey' },
  oracle_fusion_risk_management_create_process_risk: { ProcessId: 'processId' },
  oracle_fusion_risk_management_create_test_plan_activity: {
    ControlId: 'controlId',
    TestPlanId: 'testPlanId',
  },
  oracle_fusion_risk_management_create_test_plan_step: { TestPlanId: 'testPlanId' },
}

async function mutationBody(
  toolId: RiskOperation,
  definition: RiskOperationDefinition,
  params: Record<string, unknown>,
  credential: OracleFusionResolvedCredential,
  signal?: AbortSignal
) {
  const body = { ...parseRiskBody(params.body) }
  let groupId: string | undefined
  if (
    definition.kind === 'create' &&
    (definition.resource === 'group_member' || definition.resource === 'group_security_assignment')
  ) {
    const group = await getRiskResource(
      'assignment_group',
      credential,
      { groupKey: params.groupKey },
      signal
    )
    const parsed = riskKeySchema.safeParse(group.GroupId)
    if (!parsed.success) {
      throw new RiskResponseError('Oracle Fusion did not return the group business identifier')
    }
    groupId = parsed.data
  }
  for (const [field, param] of Object.entries(parentBodyBindings[toolId] ?? {})) {
    const expected =
      param === 'groupKey' ? groupId : identifier(definition.resource, param, params[param])
    if (expected === undefined) throw new RiskInputError('Missing parent identifier')
    const actual =
      body[field] === undefined
        ? undefined
        : param === 'groupKey'
          ? riskKeySchema.parse(body[field])
          : identifier(definition.resource, param, body[field])
    if (actual !== undefined && actual !== expected) {
      throw new RiskInputError('Body parent identifier must match the selected resource')
    }
    body[field] = expected
  }
  const operation = toolId.slice(
    'oracle_fusion_risk_management_'.length
  ) as keyof typeof riskWriteSchemas
  const schema = riskWriteSchemas[operation]
  if (!schema) throw new RiskInputError('Unsupported Risk Management mutation')
  return schema.parse(body)
}

export async function executeRiskOperation(
  toolId: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  if (!Object.hasOwn(RISK_OPERATIONS, toolId)) {
    throw new RiskInputError('Unsupported Oracle Fusion Risk Management operation')
  }
  signal?.throwIfAborted()
  const id = toolId as RiskOperation
  const definition: RiskOperationDefinition = RISK_OPERATIONS[id]
  const params = parseInput(definition, input)
  const credential = {
    instanceUrl: params.instanceUrl as string,
    accessToken: params.accessToken as string,
  }
  if (definition.kind === 'action') {
    const run = id === 'oracle_fusion_risk_management_run_access_simulation'
    const body = run
      ? {
          userName: params.userName,
          provisioningInfo: simulationInfoSchema.parse(parseRiskBody(params.provisioningInfo)),
        }
      : { requestId: oracleFusionExactInteger(riskIdentifierSchema.parse(params.requestId)) }
    const action = run ? 'runUserProvisioningAnalysis' : 'getRequestStatus'
    const raw = await requestOracleFusionJson(
      credential,
      {
        method: 'POST',
        address: {
          family: 'fscm',
          relativePath: `advancedControlsRolesProvisioning/action/${action}`,
        },
        mediaType: 'application/vnd.oracle.adf.action+json',
        body,
      },
      signal
    )
    const parsed = stringActionSchema.safeParse(raw)
    if (!parsed.success) {
      throw new RiskResponseError('Oracle Fusion returned an invalid simulation result')
    }
    return {
      success: true,
      output: run ? { requestId: parsed.data.result } : { status: parsed.data.result },
    }
  }
  const resource = definition.resource
  if (definition.kind === 'list') {
    return { success: true, output: await listRiskResource(resource, credential, params, signal) }
  }
  if (definition.kind === 'get') {
    return {
      success: true,
      output: { record: await getRiskResource(resource, credential, params, signal) },
    }
  }
  const address =
    definition.kind === 'create'
      ? collectionAddress(resource, params)
      : detailAddress(resource, params)
  if (definition.kind === 'delete') {
    await requestOracleFusionEmpty(credential, { method: 'DELETE', address }, signal)
    return { success: true, output: { deleted: true } }
  }
  const body = await mutationBody(id, definition, params, credential, signal)
  const raw = await requestOracleFusionJson(
    credential,
    {
      method: definition.kind === 'create' ? 'POST' : 'PATCH',
      address,
      mediaType: 'application/vnd.oracle.adf.resourceitem+json',
      body,
    },
    signal
  )
  /** AssertionCode is part of Oracle's composite key, so PATCH can return a new self key. */
  const changesAssertionKey = id === 'oracle_fusion_risk_management_update_control_assertion'
  const record = verifyResource(
    resource,
    raw,
    credential,
    params,
    definition.kind === 'update' && !changesAssertionKey ? address : undefined
  )
  if (
    changesAssertionKey &&
    (record.ControlId !== params.controlId ||
      record.AssertionCode !== (body as { AssertionCode: string }).AssertionCode)
  ) {
    throw new RiskResponseError(
      'Oracle Fusion returned a different control assertion than requested'
    )
  }
  return { success: true, output: { record } }
}
