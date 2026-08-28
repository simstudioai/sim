import { createLogger } from '@sim/logger'
import type {
  JsmApprovalsBody,
  JsmCommentBody,
  JsmCommentsBody,
  JsmCustomersBody,
  JsmOrganizationBody,
  JsmOrganizationsBody,
  JsmParticipantsBody,
  JsmQueuesBody,
  JsmRequestBody,
  JsmRequestsBody,
  JsmRequestTypeFieldsBody,
  JsmRequestTypesBody,
  JsmServiceDesksBody,
  JsmSlaBody,
  JsmTransitionBody,
  JsmTransitionsBody,
} from '@/lib/api/contracts/selectors/jsm'
import {
  validateAlphanumericId,
  validateEnum,
  validateJiraIssueKey,
} from '@/lib/core/security/input-validation'
import { asArray, asObject, createJsmClient } from '@/lib/internal/jsm/client'
import { JsmOperationError } from '@/lib/internal/jsm/errors'

const logger = createLogger('JsmServiceDeskOperations')
const SELECTOR_PAGE_SIZE = 100
const SELECTOR_MAX_PAGES = 50

function validateId(value: string, field: string): void {
  const validation = validateAlphanumericId(value, field)
  if (!validation.isValid) throw new JsmOperationError(validation.error || `Invalid ${field}`, 400)
}

function validateIssue(value: string): void {
  const validation = validateJiraIssueKey(value, 'issueIdOrKey')
  if (!validation.isValid) {
    throw new JsmOperationError(validation.error || 'Invalid issueIdOrKey', 400)
  }
}

function append(query: URLSearchParams, key: string, value: unknown): void {
  if (value !== undefined && value !== null && value !== '') query.append(key, String(value))
}

function pagedOutput(data: Record<string, unknown>, key: string, context = {}) {
  return {
    ts: new Date().toISOString(),
    ...context,
    [key]: data.values || [],
    total: data.size || 0,
    isLastPage: data.isLastPage ?? true,
  }
}

function csv(value: string | string[] | undefined): string[] {
  if (!value) return []
  return Array.isArray(value)
    ? value
    : value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
}

function serviceDeskPath(serviceDeskId: string, suffix: string): string {
  return `/servicedesk/${encodeURIComponent(serviceDeskId)}${suffix}`
}

export async function executeJsmGetServiceDesks(input: JsmServiceDesksBody, signal?: AbortSignal) {
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'expand', input.expand)
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(`/servicedesk${query.size ? `?${query}` : ''}`),
    {},
    signal,
    true
  )
  return { success: true, output: pagedOutput(data, 'serviceDesks') }
}

export async function executeJsmGetQueues(input: JsmQueuesBody, signal?: AbortSignal) {
  validateId(input.serviceDeskId, 'serviceDeskId')
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'includeCount', input.includeCount)
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(
      `${serviceDeskPath(input.serviceDeskId, '/queue')}${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  return { success: true, output: pagedOutput(data, 'queues') }
}

export async function executeJsmGetRequestTypes(input: JsmRequestTypesBody, signal?: AbortSignal) {
  validateId(input.serviceDeskId, 'serviceDeskId')
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'searchQuery', input.searchQuery)
  append(query, 'groupId', input.groupId)
  append(query, 'expand', input.expand)
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(
      `${serviceDeskPath(input.serviceDeskId, '/requesttype')}${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  return { success: true, output: pagedOutput(data, 'requestTypes') }
}

export async function executeJsmGetRequestTypeFields(
  input: JsmRequestTypeFieldsBody,
  signal?: AbortSignal
) {
  validateId(input.serviceDeskId, 'serviceDeskId')
  validateId(input.requestTypeId, 'requestTypeId')
  const client = await createJsmClient(input, signal)
  const data = await client.json(
    client.service(
      serviceDeskPath(
        input.serviceDeskId,
        `/requesttype/${encodeURIComponent(input.requestTypeId)}/field`
      )
    ),
    {},
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      serviceDeskId: input.serviceDeskId,
      requestTypeId: input.requestTypeId,
      canAddRequestParticipants: data.canAddRequestParticipants ?? false,
      canRaiseOnBehalfOf: data.canRaiseOnBehalfOf ?? false,
      requestTypeFields: asArray(data.requestTypeFields).map((entry) => {
        const field = asObject(entry)
        return {
          fieldId: field.fieldId ?? null,
          name: field.name ?? null,
          description: field.description ?? null,
          required: field.required ?? false,
          visible: field.visible ?? true,
          validValues: field.validValues ?? [],
          presetValues: field.presetValues ?? [],
          defaultValues: field.defaultValues ?? [],
          jiraSchema: field.jiraSchema ?? null,
        }
      }),
    },
  }
}

const REQUEST_OWNERSHIP = [
  'OWNED_REQUESTS',
  'PARTICIPATED_REQUESTS',
  'APPROVER',
  'ALL_REQUESTS',
] as const
const REQUEST_STATUS = ['OPEN_REQUESTS', 'CLOSED_REQUESTS', 'ALL_REQUESTS'] as const

function requireAction<T extends readonly string[]>(
  action: string,
  allowed: T,
  expected: T[number]
): void {
  const validation = validateEnum(action, allowed, 'action')
  if (!validation.isValid) {
    throw new JsmOperationError(validation.error || 'Invalid action', 400)
  }
  if (action !== expected) throw new JsmOperationError('Invalid action', 400)
}

export async function executeJsmGetRequests(input: JsmRequestsBody, signal?: AbortSignal) {
  if (input.serviceDeskId) validateId(input.serviceDeskId, 'serviceDeskId')
  if (input.requestOwnership) {
    const result = validateEnum(input.requestOwnership, REQUEST_OWNERSHIP, 'requestOwnership')
    if (!result.isValid)
      throw new JsmOperationError(result.error || 'Invalid requestOwnership', 400)
  }
  if (input.requestStatus) {
    const result = validateEnum(input.requestStatus, REQUEST_STATUS, 'requestStatus')
    if (!result.isValid) throw new JsmOperationError(result.error || 'Invalid requestStatus', 400)
  }
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'serviceDeskId', input.serviceDeskId)
  append(query, 'requestOwnership', input.requestOwnership)
  append(query, 'requestStatus', input.requestStatus)
  append(query, 'requestTypeId', input.requestTypeId)
  append(query, 'searchTerm', input.searchTerm)
  append(query, 'expand', input.expand)
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(`/request${query.size ? `?${query}` : ''}`),
    {},
    signal,
    true
  )
  return { success: true, output: pagedOutput(data, 'requests') }
}

function currentStatus(data: Record<string, unknown>) {
  const value = asObject(data.currentStatus)
  return data.currentStatus
    ? {
        status: value.status ?? null,
        statusCategory: value.statusCategory ?? null,
        statusDate: value.statusDate ?? null,
      }
    : null
}

function reporter(data: Record<string, unknown>, includeActive: boolean) {
  if (!data.reporter) return null
  const value = asObject(data.reporter)
  return {
    accountId: value.accountId ?? null,
    displayName: value.displayName ?? null,
    emailAddress: value.emailAddress ?? null,
    ...(includeActive ? { active: value.active ?? true } : {}),
  }
}

export async function executeJsmCreateRequest(input: JsmRequestBody, signal?: AbortSignal) {
  if (!input.serviceDeskId || !input.requestTypeId || (!input.summary && !input.formAnswers)) {
    throw new JsmOperationError(
      'Service Desk ID, Request Type ID, and summary or form answers are required',
      400
    )
  }
  validateId(input.serviceDeskId, 'serviceDeskId')
  validateId(input.requestTypeId, 'requestTypeId')
  const client = await createJsmClient(input, signal)
  const body: Record<string, unknown> = {
    serviceDeskId: input.serviceDeskId,
    requestTypeId: input.requestTypeId,
  }
  if (input.formAnswers) {
    body.form = { answers: input.formAnswers }
    if (input.requestFieldValues) body.requestFieldValues = input.requestFieldValues
  } else if (input.summary || input.description || input.requestFieldValues) {
    body.requestFieldValues = input.requestFieldValues
      ? {
          ...(!input.requestFieldValues.summary && input.summary ? { summary: input.summary } : {}),
          ...(!input.requestFieldValues.description && input.description
            ? { description: input.description }
            : {}),
          ...input.requestFieldValues,
        }
      : {
          ...(input.summary ? { summary: input.summary } : {}),
          ...(input.description ? { description: input.description } : {}),
        }
  }
  if (input.raiseOnBehalfOf) body.raiseOnBehalfOf = input.raiseOnBehalfOf
  if (input.requestParticipants) body.requestParticipants = csv(input.requestParticipants)
  if (input.channel) body.channel = input.channel
  const data = await client.json(
    client.service('/request'),
    { method: 'POST', body: JSON.stringify(body) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueId: data.issueId,
      issueKey: data.issueKey,
      requestTypeId: data.requestTypeId,
      serviceDeskId: data.serviceDeskId,
      createdDate: data.createdDate ?? null,
      currentStatus: currentStatus(data),
      reporter: reporter(data, false),
      success: true,
      url: `https://${input.domain}/browse/${String(data.issueKey)}`,
    },
  }
}

export async function executeJsmGetRequest(input: JsmRequestBody, signal?: AbortSignal) {
  if (!input.issueIdOrKey) throw new JsmOperationError('Issue ID or key is required', 400)
  validateIssue(input.issueIdOrKey)
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'expand', input.expand)
  const data = await client.json(
    client.service(
      `/request/${encodeURIComponent(input.issueIdOrKey)}${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueId: data.issueId ?? null,
      issueKey: data.issueKey ?? null,
      requestTypeId: data.requestTypeId ?? null,
      serviceDeskId: data.serviceDeskId ?? null,
      createdDate: data.createdDate ?? null,
      currentStatus: currentStatus(data),
      reporter: reporter(data, true),
      requestFieldValues: asArray(data.requestFieldValues).map((entry) => {
        const field = asObject(entry)
        return {
          fieldId: field.fieldId ?? null,
          label: field.label ?? null,
          value: field.value ?? null,
        }
      }),
      url: `https://${input.domain}/browse/${String(data.issueKey)}`,
      request: data,
    },
  }
}

export async function executeJsmAddComment(input: JsmCommentBody, signal?: AbortSignal) {
  validateIssue(input.issueIdOrKey)
  const client = await createJsmClient(input, signal)
  const data = await client.json(
    client.service(`/request/${encodeURIComponent(input.issueIdOrKey)}/comment`),
    { method: 'POST', body: JSON.stringify({ body: input.body, public: input.isPublic ?? true }) },
    signal,
    true
  )
  const author = asObject(data.author)
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      commentId: data.id,
      body: data.body,
      isPublic: data.public,
      author: data.author
        ? {
            accountId: author.accountId ?? null,
            displayName: author.displayName ?? null,
            emailAddress: author.emailAddress ?? null,
          }
        : null,
      createdDate: data.created ?? null,
      success: true,
    },
  }
}

async function issuePage(
  input: JsmCommentsBody | JsmSlaBody | JsmTransitionsBody,
  suffix: string,
  key: string,
  extra: Record<string, unknown>,
  signal?: AbortSignal
) {
  validateIssue(input.issueIdOrKey)
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  if ('isPublic' in input) append(query, 'public', input.isPublic)
  if ('internal' in input) append(query, 'internal', input.internal)
  if ('expand' in input) append(query, 'expand', input.expand)
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(
      `/request/${encodeURIComponent(input.issueIdOrKey)}/${suffix}${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  return {
    success: true,
    output: pagedOutput(data, key, { issueIdOrKey: input.issueIdOrKey, ...extra }),
  }
}

export function executeJsmGetComments(input: JsmCommentsBody, signal?: AbortSignal) {
  return issuePage(input, 'comment', 'comments', {}, signal)
}

export async function executeJsmTransitionRequest(input: JsmTransitionBody, signal?: AbortSignal) {
  validateIssue(input.issueIdOrKey)
  validateId(input.transitionId, 'transitionId')
  const client = await createJsmClient(input, signal)
  const body: Record<string, unknown> = { id: input.transitionId }
  if (input.comment) body.additionalComment = { body: input.comment }
  await client.empty(
    client.service(`/request/${encodeURIComponent(input.issueIdOrKey)}/transition`),
    { method: 'POST', body: JSON.stringify(body) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      transitionId: input.transitionId,
      success: true,
    },
  }
}

export function executeJsmGetTransitions(input: JsmTransitionsBody, signal?: AbortSignal) {
  return issuePage(input, 'transition', 'transitions', {}, signal)
}

export function executeJsmGetSla(input: JsmSlaBody, signal?: AbortSignal) {
  return issuePage(input, 'sla', 'slas', {}, signal)
}

export async function executeJsmGetApprovals(input: JsmApprovalsBody, signal?: AbortSignal) {
  requireAction(input.action, ['get', 'answer'] as const, 'get')
  validateIssue(input.issueIdOrKey)
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(
      `/request/${encodeURIComponent(input.issueIdOrKey)}/approval${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  return {
    success: true,
    output: pagedOutput(data, 'approvals', { issueIdOrKey: input.issueIdOrKey }),
  }
}

export async function executeJsmAnswerApproval(input: JsmApprovalsBody, signal?: AbortSignal) {
  requireAction(input.action, ['get', 'answer'] as const, 'answer')
  validateIssue(input.issueIdOrKey)
  if (!input.approvalId) throw new JsmOperationError('Approval ID is required', 400)
  validateId(input.approvalId, 'approvalId')
  const decision = validateEnum(input.decision, ['approve', 'decline'] as const, 'decision')
  if (!decision.isValid) throw new JsmOperationError(decision.error || 'Invalid decision', 400)
  const client = await createJsmClient(input, signal)
  const data = await client.json(
    client.service(
      `/request/${encodeURIComponent(input.issueIdOrKey)}/approval/${encodeURIComponent(input.approvalId)}`
    ),
    { method: 'POST', body: JSON.stringify({ decision: input.decision }) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      approvalId: input.approvalId,
      decision: input.decision,
      id: data.id ?? null,
      name: data.name ?? null,
      finalDecision: data.finalDecision ?? null,
      canAnswerApproval: data.canAnswerApproval ?? null,
      approvers: asArray(data.approvers).map((entry) => {
        const item = asObject(entry)
        const approver = asObject(item.approver)
        return {
          approver: {
            accountId: approver.accountId ?? null,
            displayName: approver.displayName ?? null,
            emailAddress: approver.emailAddress ?? null,
            active: approver.active ?? null,
          },
          approverDecision: item.approverDecision ?? null,
        }
      }),
      createdDate: data.createdDate ?? null,
      completedDate: data.completedDate ?? null,
      approval: data,
      success: true,
    },
  }
}

export async function executeJsmGetParticipants(input: JsmParticipantsBody, signal?: AbortSignal) {
  requireAction(input.action, ['get', 'add'] as const, 'get')
  validateIssue(input.issueIdOrKey)
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(
      `/request/${encodeURIComponent(input.issueIdOrKey)}/participant${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  return {
    success: true,
    output: pagedOutput(data, 'participants', { issueIdOrKey: input.issueIdOrKey }),
  }
}

export async function executeJsmAddParticipants(input: JsmParticipantsBody, signal?: AbortSignal) {
  requireAction(input.action, ['get', 'add'] as const, 'add')
  validateIssue(input.issueIdOrKey)
  if (!input.accountIds) throw new JsmOperationError('Account IDs are required', 400)
  const client = await createJsmClient(input, signal)
  const data = await client.json(
    client.service(`/request/${encodeURIComponent(input.issueIdOrKey)}/participant`),
    { method: 'POST', body: JSON.stringify({ accountIds: csv(input.accountIds) }) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueIdOrKey: input.issueIdOrKey,
      participants: data.values || [],
      success: true,
    },
  }
}

async function customerClient(input: JsmCustomersBody, signal?: AbortSignal) {
  validateId(input.serviceDeskId, 'serviceDeskId')
  return createJsmClient(input, signal)
}

export async function executeJsmGetCustomers(input: JsmCustomersBody, signal?: AbortSignal) {
  if (input.emails !== undefined)
    throw new JsmOperationError(
      'The `emails` parameter is no longer supported. Use `accountIds` (Atlassian account IDs) instead.',
      400
    )
  const client = await customerClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'query', input.query)
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(
      `${serviceDeskPath(input.serviceDeskId, '/customer')}${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  return { success: true, output: pagedOutput(data, 'customers') }
}

export async function executeJsmAddCustomer(input: JsmCustomersBody, signal?: AbortSignal) {
  if (input.emails !== undefined)
    throw new JsmOperationError(
      'The `emails` parameter is no longer supported. Use `accountIds` (Atlassian account IDs) instead.',
      400
    )
  const accountIds = csv(input.accountIds)
  if (!accountIds.length) throw new JsmOperationError('Account IDs are required', 400)
  const client = await customerClient(input, signal)
  await client.empty(
    client.service(serviceDeskPath(input.serviceDeskId, '/customer')),
    { method: 'POST', body: JSON.stringify({ accountIds }) },
    signal,
    true
  )
  return {
    success: true,
    output: { ts: new Date().toISOString(), serviceDeskId: input.serviceDeskId, success: true },
  }
}

export async function executeJsmGetOrganizations(
  input: JsmOrganizationsBody,
  signal?: AbortSignal
) {
  validateId(input.serviceDeskId, 'serviceDeskId')
  const client = await createJsmClient(input, signal)
  const query = new URLSearchParams()
  append(query, 'start', input.start)
  append(query, 'limit', input.limit)
  const data = await client.json(
    client.service(
      `${serviceDeskPath(input.serviceDeskId, '/organization')}${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  return { success: true, output: pagedOutput(data, 'organizations') }
}

export async function executeJsmCreateOrganization(
  input: JsmOrganizationBody,
  signal?: AbortSignal
) {
  requireAction(input.action, ['create', 'add_to_service_desk'] as const, 'create')
  if (!input.name) throw new JsmOperationError('Organization name is required', 400)
  const client = await createJsmClient(input, signal)
  const data = await client.json(
    client.service('/organization'),
    { method: 'POST', body: JSON.stringify({ name: input.name }) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      organizationId: data.id,
      name: data.name,
      success: true,
    },
  }
}

export async function executeJsmAddOrganization(input: JsmOrganizationBody, signal?: AbortSignal) {
  requireAction(input.action, ['create', 'add_to_service_desk'] as const, 'add_to_service_desk')
  if (!input.serviceDeskId) throw new JsmOperationError('Service Desk ID is required', 400)
  if (!input.organizationId) throw new JsmOperationError('Organization ID is required', 400)
  validateId(input.serviceDeskId, 'serviceDeskId')
  validateId(input.organizationId, 'organizationId')
  const organizationId = Number.parseInt(input.organizationId.trim(), 10)
  if (!Number.isFinite(organizationId) || organizationId <= 0) {
    throw new JsmOperationError('organizationId must be a positive integer', 400)
  }
  const client = await createJsmClient(input, signal)
  await client.empty(
    client.service(serviceDeskPath(input.serviceDeskId, '/organization')),
    { method: 'POST', body: JSON.stringify({ organizationId }) },
    signal,
    true
  )
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      serviceDeskId: input.serviceDeskId,
      organizationId: input.organizationId,
      success: true,
    },
  }
}

interface SelectorConnectionInput {
  domain: string
  accessToken: string
}

async function collectSelectorValues(
  input: SelectorConnectionInput,
  path: string,
  signal?: AbortSignal
): Promise<Record<string, unknown>[]> {
  const client = await createJsmClient(input, signal)
  const values: Record<string, unknown>[] = []
  let start = 0
  for (let page = 0; page < SELECTOR_MAX_PAGES; page++) {
    signal?.throwIfAborted()
    const data = await client.json(
      client.service(`${path}?start=${start}&limit=${SELECTOR_PAGE_SIZE}`),
      {},
      signal
    )
    const pageValues = asArray(data.values).map(asObject)
    values.push(...pageValues)
    const links = asObject(data._links)
    if (data.isLastPage === true || !links.next || pageValues.length === 0) return values
    start += pageValues.length
  }
  logger.warn('JSM selector hit pagination cap; list may be incomplete', {
    pages: SELECTOR_MAX_PAGES,
    collected: values.length,
    path,
  })
  return values
}

export async function listJsmServiceDeskOptions(
  input: SelectorConnectionInput,
  signal?: AbortSignal
) {
  const values = await collectSelectorValues(input, '/servicedesk', signal)
  return values.map((value) => ({ id: String(value.id), name: String(value.projectName) }))
}

export async function listJsmRequestTypeOptions(
  input: SelectorConnectionInput & { serviceDeskId: string },
  signal?: AbortSignal
) {
  validateId(input.serviceDeskId, 'serviceDeskId')
  const values = await collectSelectorValues(
    input,
    serviceDeskPath(input.serviceDeskId, '/requesttype'),
    signal
  )
  return values.map((value) => ({ id: String(value.id), name: String(value.name) }))
}
