import type { Logger } from '@sim/logger'
import { createLogger } from '@sim/logger'
import { validateAlphanumericId, validateJiraIssueKey } from '@/lib/core/security/input-validation'
import { createJiraClient, type JiraClient } from '@/lib/internal/jira/client'
import { JiraOperationError } from '@/lib/internal/jira/errors'
import type {
  JiraAddAttachmentInput,
  JiraUpdateInput,
  JiraWriteInput,
} from '@/lib/internal/jira/input'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'
import { processFilesToUserFiles } from '@/lib/uploads/utils/file-utils'
import { downloadServableFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import { docNotReadyResponse } from '@/lib/uploads/utils/servable-file-response'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import { parseAtlassianErrorMessage, toAdf } from '@/tools/jira/utils'

const logger = createLogger('JiraInternalOperation')

export interface JiraOperationContext {
  userId: string
  requestId: string
  signal?: AbortSignal
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {}
}

function parseObject(text: string): JsonObject {
  return asObject(JSON.parse(text))
}

function optionalObject(text: string): JsonObject {
  if (!text) return {}
  try {
    return parseObject(text)
  } catch {
    return {}
  }
}

function nestedString(value: unknown, key: string): string | undefined {
  const nested = asObject(value)[key]
  return typeof nested === 'string' ? nested : undefined
}

function providerError(
  response: { status: number; statusText: string; text: string },
  includeDetails: boolean
): JiraOperationError {
  const message = parseAtlassianErrorMessage(response.status, response.statusText, response.text)
  return new JiraOperationError(
    response.status,
    includeDetails ? { error: message, details: response.text } : { success: false, error: message }
  )
}

function putOptionalIssueFields(
  fields: JsonObject,
  input: Pick<
    JiraUpdateInput,
    | 'description'
    | 'priority'
    | 'assignee'
    | 'labels'
    | 'components'
    | 'duedate'
    | 'fixVersions'
    | 'environment'
    | 'customFieldId'
    | 'customFieldValue'
  >,
  includeAssignee: boolean
): void {
  if (input.description !== undefined && input.description !== '') {
    fields.description = toAdf(input.description)
  }
  if (input.priority) {
    fields.priority = /^\d+$/.test(input.priority)
      ? { id: input.priority }
      : { name: input.priority }
  }
  if (includeAssignee && input.assignee) fields.assignee = { accountId: input.assignee }
  if (input.labels?.length) fields.labels = input.labels
  if (input.components?.length) fields.components = input.components.map((name) => ({ name }))
  if (input.duedate) fields.duedate = input.duedate
  if (input.fixVersions?.length) {
    fields.fixVersions = input.fixVersions.map((name) => ({ name }))
  }
  if (input.environment !== undefined && input.environment !== '') {
    fields.environment = toAdf(input.environment)
  }
  if (input.customFieldId && input.customFieldValue) {
    const fieldId = input.customFieldId.startsWith('customfield_')
      ? input.customFieldId
      : `customfield_${input.customFieldId}`
    fields[fieldId] = input.customFieldValue
  }
}

async function assignCreatedIssue(
  client: JiraClient,
  issueKey: string,
  assignee: string,
  signal?: AbortSignal
): Promise<boolean> {
  signal?.throwIfAborted()
  const response = await client.request(
    client.issuePath(`/${issueKey}/assignee`),
    {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId: assignee }),
    },
    signal
  )
  if (!response.ok) {
    logger.warn('Failed to assign issue after successful creation', {
      status: response.status,
      error: response.text,
    })
    return false
  }
  return true
}

export async function executeJiraWrite(input: JiraWriteInput, context: JiraOperationContext) {
  context.signal?.throwIfAborted()
  const client = await createJiraClient(input, {
    signal: context.signal,
    validateCloudId: true,
  })
  const projectIdValidation = validateAlphanumericId(input.projectId, 'projectId', 100)
  if (!projectIdValidation.isValid) {
    throw new JiraOperationError(400, { error: projectIdValidation.error })
  }

  const fields: JsonObject = {
    project: /^\d+$/.test(input.projectId) ? { id: input.projectId } : { key: input.projectId },
    issuetype: { name: input.issueType || 'Task' },
    summary: input.summary,
  }
  putOptionalIssueFields(fields, input, false)
  if (input.parent) {
    fields.parent =
      typeof input.parent === 'string'
        ? /^\d+$/.test(input.parent)
          ? { id: input.parent }
          : { key: input.parent }
        : input.parent
  }
  if (input.reporter) fields.reporter = { accountId: input.reporter }

  const response = await client.request(
    client.issuePath(),
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    },
    context.signal
  )
  if (!response.ok) throw providerError(response, true)

  const data = parseObject(response.text)
  const issueKey = typeof data.key === 'string' ? data.key : 'unknown'
  const assigneeId =
    input.assignee && (await assignCreatedIssue(client, issueKey, input.assignee, context.signal))
      ? input.assignee
      : undefined
  context.signal?.throwIfAborted()

  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      id: typeof data.id === 'string' ? data.id : '',
      issueKey,
      self: typeof data.self === 'string' ? data.self : '',
      summary: nestedString(data.fields, 'summary') || input.summary || 'Issue created',
      success: true,
      url: `https://${input.domain}/browse/${issueKey}`,
      ...(assigneeId ? { assigneeId } : {}),
    },
  }
}

export async function executeJiraUpdate(input: JiraUpdateInput, context: JiraOperationContext) {
  context.signal?.throwIfAborted()
  const client = await createJiraClient(input, {
    signal: context.signal,
    validateCloudId: true,
  })
  const issueKeyValidation = validateJiraIssueKey(input.issueKey, 'issueKey')
  if (!issueKeyValidation.isValid) {
    throw new JiraOperationError(400, { error: issueKeyValidation.error })
  }

  const fields: JsonObject = {}
  if (input.summary) fields.summary = input.summary
  putOptionalIssueFields(fields, input, true)
  const notifyParam =
    input.notifyUsers === false
      ? '?notifyUsers=false'
      : input.notifyUsers === true
        ? '?notifyUsers=true'
        : ''
  const response = await client.request(
    `${client.issuePath(`/${input.issueKey}`)}${notifyParam}`,
    {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    },
    context.signal
  )
  if (!response.ok) throw providerError(response, true)

  const data = optionalObject(response.text)
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueKey: typeof data.key === 'string' ? data.key : input.issueKey,
      summary: nestedString(data.fields, 'summary') || input.summary || 'Issue updated',
      success: true,
    },
  }
}

async function throwResponse(response: Response): Promise<never> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = { success: false, error: response.statusText || 'Jira operation failed' }
  }
  throw new JiraOperationError(response.status, body)
}

function attachmentObject(value: unknown) {
  const object = asObject(value)
  return {
    id: typeof object.id === 'string' ? object.id : '',
    filename: typeof object.filename === 'string' ? object.filename : '',
    mimeType: typeof object.mimeType === 'string' ? object.mimeType : '',
    size: typeof object.size === 'number' ? object.size : 0,
    content: typeof object.content === 'string' ? object.content : '',
  }
}

export async function executeJiraAddAttachment(
  input: JiraAddAttachmentInput,
  context: JiraOperationContext,
  routeLogger: Logger = logger
) {
  context.signal?.throwIfAborted()
  const issueKeyValidation = validateJiraIssueKey(input.issueKey, 'issueKey')
  if (!issueKeyValidation.isValid) {
    throw new JiraOperationError(400, { error: issueKeyValidation.error })
  }
  const userFiles = processFilesToUserFiles(input.files, context.requestId, routeLogger)
  if (userFiles.length === 0) {
    throw new JiraOperationError(400, {
      success: false,
      error: 'No valid files provided for upload',
    })
  }

  const client = await createJiraClient(input, {
    signal: context.signal,
    validateCloudId: true,
  })
  const formData = new FormData()
  let remainingBytes = MAX_BUFFERED_TRANSFER_BYTES

  for (const file of userFiles) {
    context.signal?.throwIfAborted()
    const denied = await assertToolFileAccess(
      file.key,
      context.userId,
      context.requestId,
      routeLogger
    )
    context.signal?.throwIfAborted()
    if (denied) await throwResponse(denied)

    let downloaded: Awaited<ReturnType<typeof downloadServableFileFromStorage>>
    try {
      downloaded = await downloadServableFileFromStorage(file, context.requestId, routeLogger, {
        maxBytes: remainingBytes,
        signal: context.signal,
      })
    } catch (error) {
      const notReady = docNotReadyResponse(error)
      if (notReady) await throwResponse(notReady)
      throw error
    }
    remainingBytes -= downloaded.buffer.length
    formData.append(
      'file',
      new Blob([new Uint8Array(downloaded.buffer)], {
        type: downloaded.contentType || file.type || 'application/octet-stream',
      }),
      file.name
    )
  }

  const response = await client.request(
    client.issuePath(`/${input.issueKey}/attachments`),
    {
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check' },
      body: formData,
    },
    context.signal
  )
  if (!response.ok) throw providerError(response, false)

  const parsed = JSON.parse(response.text) as unknown
  const values = Array.isArray(parsed) ? parsed : []
  const attachments = values.map(attachmentObject)
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      issueKey: input.issueKey,
      attachments,
      attachmentIds: attachments.map((attachment) => attachment.id).filter(Boolean),
      files: userFiles,
    },
  }
}
