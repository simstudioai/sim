import {
  normalizeOracleFusionApplicationOrigin,
  ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import type { OracleFusionResolvedCredential } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import {
  getRiskResource,
  listRiskResource,
} from '@/lib/internal/oracle-fusion-risk-management/operations'
import {
  RISK_MAX_OFFSET,
  RISK_PAGE_SIZE,
} from '@/lib/internal/oracle-fusion-risk-management/schema'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { selectorProviderStatusError } from '@/lib/selectors/server/providers/provider-http'
import {
  definePreparedSelectorAttachment,
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'
import type { RiskResource } from '@/tools/oracle_fusion_risk_management/types'
import type { SafeSelectorOption } from '@/lib/selectors/types'

type RiskSelectorKey = Extract<ServerSelectorKey, `oracle_fusion_risk_management.${string}`>

interface SelectorDefinition {
  resource: RiskResource
  id: string
  labels: readonly string[]
  param: string
}

const definitions = {
  'oracle_fusion_risk_management.process': { resource: 'process', id: 'ProcessId', labels: ['Name'], param: 'processId' },
  'oracle_fusion_risk_management.risk': { resource: 'risk', id: 'RiskId', labels: ['Name'], param: 'riskId' },
  'oracle_fusion_risk_management.control': { resource: 'control', id: 'ControlId', labels: ['Name'], param: 'controlId' },
  'oracle_fusion_risk_management.issue': { resource: 'issue', id: 'IssueId', labels: ['Name'], param: 'issueId' },
  'oracle_fusion_risk_management.process_assessment_result': { resource: 'process_assessment_result', id: 'ResultId', labels: ['ResultId'], param: 'processAssessmentResultId' },
  'oracle_fusion_risk_management.risk_assessment_result': { resource: 'risk_assessment_result', id: 'ResultId', labels: ['ResultId'], param: 'riskAssessmentResultId' },
  'oracle_fusion_risk_management.control_assessment_result': { resource: 'control_assessment_result', id: 'ResultId', labels: ['ResultId'], param: 'controlAssessmentResultId' },
  'oracle_fusion_risk_management.advanced_control': { resource: 'advanced_control', id: 'Id', labels: ['Name'], param: 'advancedControlId' },
  'oracle_fusion_risk_management.open_incident': { resource: 'open_incident', id: 'key', labels: ['ResultId'], param: 'openIncidentKey' },
  'oracle_fusion_risk_management.advanced_control_job': { resource: 'advanced_control_job', id: 'Id', labels: ['Name'], param: 'jobId' },
  'oracle_fusion_risk_management.assignment_group': { resource: 'assignment_group', id: 'key', labels: ['Name'], param: 'groupKey' },
  'oracle_fusion_risk_management.securable_type': { resource: 'securable_type', id: 'key', labels: ['Meaning'], param: 'securableTypeKey' },
} as const satisfies Record<RiskSelectorKey, SelectorDefinition>

async function prepareDestination(
  args: ExecuteServerSelectorArgs
): Promise<OracleFusionResolvedCredential> {
  args.signal?.throwIfAborted()
  const credential = args.credential
  const access = credential?.access
  if (!credential || access?.credentialType !== 'service_account' || !access.resolvedCredentialId) {
    throw new SelectorConnectionUnavailableError()
  }
  const account = await resolveOAuthAccountId(access.resolvedCredentialId)
  if (
    account?.credentialType !== 'service_account' ||
    account.providerId !== ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const bundle = await resolveSelectorCredentialBundle({
    credential,
    protectedValues: args.protectedValues,
  })
  if (!bundle.instanceUrl) throw new SelectorConnectionUnavailableError()
  const instanceUrl = normalizeOracleFusionApplicationOrigin(bundle.instanceUrl)
  if (!instanceUrl) throw new SelectorConnectionUnavailableError()
  return { instanceUrl, accessToken: bundle.accessToken }
}

function parseOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^(?:0|[1-9][0-9]{0,6})$/.test(cursor)) throw new SelectorContextUnavailableError()
  /** Pagination only; Oracle business identifiers never use Number(). */
  const offset = Number(cursor)
  if (offset > RISK_MAX_OFFSET) throw new SelectorContextUnavailableError()
  return offset
}

function projectOption(
  item: Record<string, unknown>,
  definition: SelectorDefinition
): SafeSelectorOption | null {
  const id = item[definition.id]
  if (id === null) return null
  if (typeof id !== 'string' || !id) throw new SelectorOptionsUnavailableError()
  const labels = definition.labels
    .map((field) => item[field])
    .filter((value): value is string => typeof value === 'string' && !!value.trim())
  return {
    id,
    label: labels[0] || id,
    ...(labels[1] && labels[1] !== labels[0] ? { meta: { detail: labels[1] } } : {}),
  }
}

async function executeRiskSelector(
  args: ExecuteServerSelectorArgs,
  credential: OracleFusionResolvedCredential
) {
  const definition: SelectorDefinition = definitions[args.selectorKey as RiskSelectorKey]
  if (!definition) throw new SelectorOptionsUnavailableError()
  const params = {}
  try {
    args.signal?.throwIfAborted()
    if (args.request.kind === 'detail') {
      const item = await getRiskResource(
        definition.resource,
        credential,
        { [definition.param]: args.request.id },
        args.signal
      )
      return detailSelectorResult(item ? projectOption(item, definition) : null)
    }
    if (args.request.search !== undefined) throw new SelectorContextUnavailableError()
    const page = await listRiskResource(
      definition.resource,
      credential,
      {
        ...params,
        limit: RISK_PAGE_SIZE,
        offset: parseOffset(args.request.cursor),
        totalResults: false,
      },
      args.signal
    )
    const options = new Map<string, SafeSelectorOption>()
    for (const item of page.items) {
      const option = projectOption(item, definition)
      if (option && !options.has(option.id)) options.set(option.id, option)
    }
    return listSelectorResult(
      [...options.values()],
      page.nextOffset === undefined ? undefined : String(page.nextOffset)
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) {
      if (args.request.kind === 'detail' && error.status === 404) return detailSelectorResult(null)
      throw selectorProviderStatusError(error.status)
    }
    if (error instanceof SelectorContextUnavailableError) throw error
    throw new SelectorOptionsUnavailableError()
  }
}

function attachment() {
  return definePreparedSelectorAttachment({
    credential: {
      kind: 'stored',
      field: 'oauthCredential',
      serviceIds: ['oracle_fusion_risk_management'],
    },
    integrationBlockTypes: ['oracle_fusion_risk_management'],
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeRiskSelector,
  })
}

export const oracleFusionRiskSelectorAttachments = {
  'oracle_fusion_risk_management.process': attachment(),
  'oracle_fusion_risk_management.risk': attachment(),
  'oracle_fusion_risk_management.control': attachment(),
  'oracle_fusion_risk_management.issue': attachment(),
  'oracle_fusion_risk_management.process_assessment_result': attachment(),
  'oracle_fusion_risk_management.risk_assessment_result': attachment(),
  'oracle_fusion_risk_management.control_assessment_result': attachment(),
  'oracle_fusion_risk_management.advanced_control': attachment(),
  'oracle_fusion_risk_management.open_incident': attachment(),
  'oracle_fusion_risk_management.advanced_control_job': attachment(),
  'oracle_fusion_risk_management.assignment_group': attachment(),
  'oracle_fusion_risk_management.securable_type': attachment(),
} satisfies ServerSelectorAttachmentMap<RiskSelectorKey>
