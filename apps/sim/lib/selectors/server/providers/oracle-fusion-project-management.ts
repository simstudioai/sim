import { isPlainRecord } from '@sim/utils/object'
import {
  normalizeOracleFusionApplicationOrigin,
  ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID,
} from '@/lib/credentials/client-credential-accounts/descriptors'
import {
  type OracleFusionResolvedCredential,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { normalizeOracleFusionDecimalIdentifier } from '@/lib/internal/oracle-fusion/identifiers'
import { parseOracleFusionCollection } from '@/lib/internal/oracle-fusion/protocol'
import { resolveOAuthAccountId } from '@/lib/oauth/credential-service'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
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
import type { SafeSelectorOption } from '@/lib/selectors/types'

type Lookup = {
  path: string
  id: string
  label: string
  detail: string
  numeric: boolean
  parents: readonly ('projectId' | 'taskId')[]
  filter?: string
  finder?: string
}

// Persist the actual write value: names for owning organizations and project roles,
// email for resource assignment, IDs for projects/tasks/types. Never substitute PersonId.
const lookups = {
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-get.html
  'oracleFusionProjectManagement.projects': {
    path: 'projects',
    id: 'ProjectId',
    label: 'ProjectName',
    detail: 'ProjectNumber',
    numeric: true,
    parents: [],
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplandetails-projectid-child-tasks-get.html
  'oracleFusionProjectManagement.tasks': {
    path: 'projectPlanDetails/{projectId}/child/Tasks',
    id: 'TaskId',
    label: 'Name',
    detail: 'TaskNumber',
    numeric: true,
    parents: ['projectId'],
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectclassifiedorganizationslov-get.html
  'oracleFusionProjectManagement.organizations': {
    path: 'projectClassifiedOrganizationsLOV',
    id: 'OrganizationName',
    label: 'OrganizationName',
    detail: 'OrganizationId',
    numeric: false,
    parents: [],
    filter: "ClassificationCode='PA_PROJECT_ORG' and Status='A'",
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectenterpriseresources-get.html
  'oracleFusionProjectManagement.resources': {
    path: 'projectEnterpriseResources',
    id: 'ResourceEmail',
    label: 'ResourceDisplayName',
    detail: 'ResourceId',
    numeric: false,
    parents: [],
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectroleslov-get.html
  'oracleFusionProjectManagement.roles': {
    path: 'projectRolesLOV',
    id: 'ProjectRoleName',
    label: 'ProjectRoleName',
    detail: 'ProjectRoleId',
    numeric: false,
    parents: [],
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverabletypeslov-get.html
  'oracleFusionProjectManagement.deliverableTypes': {
    path: 'deliverableTypesLOV',
    id: 'DeliverableTypeId',
    label: 'Name',
    detail: 'DeliverableTypeClass',
    numeric: true,
    parents: [],
    finder: 'findDeliverableTypes',
    filter: 'DisabledFlag=false',
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectstatuseslov-get.html
  'oracleFusionProjectManagement.statuses': {
    path: 'projectStatusesLOV',
    id: 'ProjectStatusCode',
    label: 'ProjectStatusName',
    detail: 'StatusObjectCode',
    numeric: false,
    parents: [],
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectteammembers-get.html
  'oracleFusionProjectManagement.teamMembers': {
    path: 'projects/{projectId}/child/ProjectTeamMembers',
    id: 'TeamMemberId',
    label: 'PersonName',
    detail: 'ProjectRole',
    numeric: true,
    parents: ['projectId'],
  },
  // https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-get.html
  'oracleFusionProjectManagement.laborAssignments': {
    path: 'projectPlans/{projectId}/child/TaskLaborResourceAssignments',
    id: 'TaskLaborResourceAssignmentId',
    label: 'ResourceName',
    detail: 'ResourceEmail',
    numeric: true,
    parents: ['projectId', 'taskId'],
  },
} as const satisfies Record<string, Lookup>

type ProjectManagementSelectorKey = Extract<ServerSelectorKey, keyof typeof lookups>
const PAGE_SIZE = 50

function contextId(value: unknown): string {
  if (typeof value !== 'string') throw new SelectorContextUnavailableError()
  const id = normalizeOracleFusionDecimalIdentifier(value.trim(), { maxDigits: 18 })
  if (!id || id === '0') throw new SelectorContextUnavailableError()
  return id
}

function queryString(value: string): string {
  if (value.length > 240 || /[\u0000-\u001f\u007f]/.test(value)) throw new SelectorContextUnavailableError()
  return `'${value.replace(/'/g, "''")}'`
}

async function prepareDestination(
  args: ExecuteServerSelectorArgs
): Promise<OracleFusionResolvedCredential> {
  args.signal?.throwIfAborted()
  const access = args.credential?.access
  if (!access?.resolvedCredentialId || access.credentialType !== 'service_account') {
    throw new SelectorConnectionUnavailableError()
  }
  const resolved = await resolveOAuthAccountId(access.resolvedCredentialId)
  args.signal?.throwIfAborted()
  if (
    resolved?.credentialType !== 'service_account' ||
    resolved.providerId !== ORACLE_FUSION_SERVICE_ACCOUNT_PROVIDER_ID
  ) {
    throw new SelectorConnectionUnavailableError()
  }
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    protectedValues: args.protectedValues,
  })
  args.signal?.throwIfAborted()
  if (!bundle.instanceUrl) throw new SelectorConnectionUnavailableError()
  const instanceUrl = normalizeOracleFusionApplicationOrigin(bundle.instanceUrl)
  if (!instanceUrl) throw new SelectorConnectionUnavailableError()
  return { accessToken: bundle.accessToken, instanceUrl }
}

function optionFromRecord(record: unknown, lookup: Lookup, key: string): SafeSelectorOption | null {
  if (!isPlainRecord(record)) throw new SelectorOptionsUnavailableError()
  const rawId = record[lookup.id]
  // Some enterprise resources have no email and cannot be used by these email-bound inputs.
  if (key === 'oracleFusionProjectManagement.resources' && (rawId === null || rawId === '')) return null
  const id = lookup.numeric ? normalizeOracleFusionDecimalIdentifier(rawId, { maxDigits: 18 }) : rawId
  if (typeof id !== 'string' || !id.trim() || id.length > 240) {
    throw new SelectorOptionsUnavailableError()
  }
  const rawLabel = record[lookup.label]
  if (rawLabel !== null && rawLabel !== undefined && typeof rawLabel !== 'string') {
    throw new SelectorOptionsUnavailableError()
  }
  let label = typeof rawLabel === 'string' && rawLabel.trim() ? rawLabel : id
  const rawDetail = record[lookup.detail]
  const detail = /Id$/.test(lookup.detail)
    ? normalizeOracleFusionDecimalIdentifier(rawDetail, { maxDigits: 18 })
    : rawDetail
  if (detail !== null && detail !== undefined && typeof detail !== 'string') {
    throw new SelectorOptionsUnavailableError()
  }
  if (key === 'oracleFusionProjectManagement.statuses') {
    if (typeof detail !== 'string' || !detail) throw new SelectorOptionsUnavailableError()
    label = `${label} (${detail})`
  }
  if (label.length > 1000 || (typeof detail === 'string' && detail.length > 1000)) {
    throw new SelectorOptionsUnavailableError()
  }
  return { id, label, ...(typeof detail === 'string' && detail ? { meta: { detail } } : {}) }
}

async function executeLookup(
  args: ExecuteServerSelectorArgs,
  destination: OracleFusionResolvedCredential
) {
  args.signal?.throwIfAborted()
  const lookup: Lookup = lookups[args.selectorKey as ProjectManagementSelectorKey]
  if (!lookup) throw new SelectorContextUnavailableError()
  for (const parent of lookup.parents) contextId(args.context[parent])
  const path = lookup.path.replace(/\{([^}]+)\}/g, () => contextId(args.context.projectId))
  const filters: string[] = lookup.filter ? [lookup.filter] : []
  if (lookup.parents.includes('taskId')) filters.push(`TaskId=${contextId(args.context.taskId)}`)
  const detail = args.request.kind === 'detail'
  let offset = 0
  if (args.request.kind === 'detail') {
    filters.push(
      `${lookup.id}=${lookup.numeric ? contextId(args.request.id) : queryString(args.request.id)}`
    )
  } else {
    const cursor = args.request.cursor
    if (cursor !== undefined) {
      if (!/^(0|[1-9]\d{0,9})$/.test(cursor)) throw new SelectorContextUnavailableError()
      offset = Number(cursor)
      if (!Number.isSafeInteger(offset) || offset >= MAX_SELECTOR_OPTIONS) {
        throw new SelectorContextUnavailableError()
      }
    }
    const search = args.request.search?.trim()
    if (search) filters.push(`${lookup.label} like ${queryString(`%${search}%`)}`)
  }
  const limit = detail ? 2 : Math.min(PAGE_SIZE, MAX_SELECTOR_OPTIONS - offset)
  try {
    const body = await requestOracleFusionJson(
      destination,
      {
        address: { family: 'fscm', relativePath: path },
        query: {
          limit,
          offset,
          fields: [...new Set([lookup.id, lookup.label, lookup.detail])].join(','),
          onlyData: true,
          orderBy: `${lookup.id}:asc`,
          ...(filters.length ? { q: filters.join(' and ') } : {}),
          ...(lookup.finder ? { finder: lookup.finder } : {}),
        },
      },
      args.signal
    )
    args.signal?.throwIfAborted()
    const page = parseOracleFusionCollection(
      body,
      (record) => optionFromRecord(record, lookup, args.selectorKey),
      { expectedOffset: offset, maxItems: limit }
    )
    const options = [
      ...new Map(page.items.flatMap((item) => (item ? [[item.id, item] as const] : []))).values(),
    ]
    if (args.request.kind === 'detail') {
      const requestedId = lookup.numeric ? contextId(args.request.id) : args.request.id
      return detailSelectorResult(options.find((item) => item.id === requestedId) ?? null)
    }
    const nextCursor =
      page.hasMore && page.nextOffset < MAX_SELECTOR_OPTIONS ? String(page.nextOffset) : undefined
    return listSelectorResult(
      options,
      nextCursor,
      page.hasMore && !nextCursor
        ? { truncated: { reason: 'provider-cap', limit: MAX_SELECTOR_OPTIONS } }
        : undefined
    )
  } catch (error) {
    args.signal?.throwIfAborted()
    if (error instanceof OracleFusionProviderError) throw selectorProviderStatusError(error.status)
    throw new SelectorOptionsUnavailableError()
  }
}

const credential = {
  kind: 'stored',
  field: 'oauthCredential',
  serviceIds: ['oracle_fusion_project_management'],
} as const
const integrationBlockTypes = ['oracle_fusion_project_management'] as const

export const oracleFusionProjectManagementSelectorAttachments = {
  'oracleFusionProjectManagement.projects': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
  'oracleFusionProjectManagement.tasks': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
  'oracleFusionProjectManagement.organizations': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
  'oracleFusionProjectManagement.resources': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
  'oracleFusionProjectManagement.roles': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
  'oracleFusionProjectManagement.deliverableTypes': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
  'oracleFusionProjectManagement.statuses': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
  'oracleFusionProjectManagement.teamMembers': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
  'oracleFusionProjectManagement.laborAssignments': definePreparedSelectorAttachment({
    credential,
    integrationBlockTypes,
    destination: { kind: 'credential-bound', prepare: prepareDestination },
    execute: executeLookup,
  }),
} satisfies ServerSelectorAttachmentMap<ProjectManagementSelectorKey>
