import { filterUndefined } from '@sim/utils/object'
import {
  type OracleFusionRiskManagementParams,
  RISK_OPERATIONS,
  type RiskOperation,
  type RiskOperationDefinition,
} from '@/tools/oracle_fusion_risk_management/types'
import type {
  InternalToolConfig,
  OAuthConfig,
  OutputProperty,
  ToolConfig,
  ToolResponse,
} from '@/tools/types'

export const RISK_OAUTH_CONFIG = {
  required: true,
  provider: 'oracle_fusion_risk_management',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export const riskAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle Fusion service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Authentication material injected by the executor',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Fusion application origin injected from the selected credential',
  },
} satisfies ToolConfig['params']

export const riskParamFields = {
  actionItemId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  activityKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  advancedControlId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Oracle identifier as a string',
  },
  assertionKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  attributeKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  commentId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  commentKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  controlAssessmentResultId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  controlId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  groupKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  incidentKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  issueId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  jobId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  memberId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  openIncidentKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  perspectiveKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  processAssessmentResultId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  processId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  provisioningInfo: {
    type: 'json',
    required: true,
    visibility: 'user-or-llm',
    description:
      'JSON object mapping role codes to arrays of data-access scope strings. Supported scope kinds: BUSINESS_UNIT, LEDGER_SET, DATA_ACCESS_SET, ASSET_BOOK, REFERENCE_DATA_SET. Maximum 100 roles and 100 scopes per role. This runs analysis only; it grants no access and creates no incidents.',
  },
  relationshipKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  requestId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Simulation request identifier returned by Run Access Simulation, preserved as a decimal string',
  },
  riskAssessmentResultId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  riskId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  roleTypeKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  securableTypeKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  securityAssignmentId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  simulationResultKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  stepId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  testPlanId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  treeId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Exact decimal identifier as a string',
  },
  userKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque key returned by the corresponding list action; retain the same parent identifiers',
  },
  userName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Exact Oracle Security Console username whose existing and proposed access will be simulated',
  },
} satisfies ToolConfig['params']

export const riskListParams = {
  q: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Oracle q filter for this resource; maximum 4096 characters',
  },
  orderBy: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm',
    description: 'Comma-separated Oracle sort fields with optional :asc or :desc',
  },
  limit: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    default: 100,
    description: 'One page of 1-100 records; default 100',
  },
  offset: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm',
    default: 0,
    description: 'Zero-based offset, at most 1000000',
  },
  totalResults: {
    type: 'boolean',
    required: false,
    visibility: 'user-or-llm',
    description: "Request Oracle's estimated total count",
  },
} satisfies ToolConfig['params']

/** Shared declarations only; each action retains an explicit tool file and server registration. */
export function createRiskTool(input: {
  id: RiskOperation
  outputs: Record<string, OutputProperty>
}): InternalToolConfig<OracleFusionRiskManagementParams, ToolResponse> {
  const { id, outputs } = input
  const definition: RiskOperationDefinition = RISK_OPERATIONS[id]
  const params: ToolConfig['params'] = { ...riskAuthParams }
  if (definition.kind === 'list') {
    for (const [name, config] of Object.entries(riskListParams)) {
      if (name === 'q' && definition.resource === 'simulation_result') continue
      params[name] = config
    }
  }
  for (const field of definition.params) {
    params[field] = riskParamFields[field as keyof typeof riskParamFields]
  }
  if (definition.bodyDescription) {
    params.body = {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: definition.bodyDescription,
    }
  }
  return {
    id,
    name: `Oracle Fusion Risk Management ${definition.label}`,
    description:
      definition.kind === 'list'
        ? `${definition.label} in Oracle Fusion Risk Management. Returns one bounded page; request nextOffset explicitly.`
        : definition.kind === 'action'
          ? `${definition.label} in Oracle Fusion Risk Management. Simulation only; no access grants or incident creation.`
          : `${definition.label} in Oracle Fusion Risk Management using documented record fields.`,
    version: '1.0.0',
    params,
    outputs,
    oauth: RISK_OAUTH_CONFIG,
    operation: {
      input: (input) => {
        const selected: Record<string, unknown> = {}
        for (const key of Object.keys(params)) selected[key] = input[key]
        return filterUndefined(selected)
      },
    },
  }
}
