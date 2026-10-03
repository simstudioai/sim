import { filterUndefined } from '@sim/utils/object'
import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import { uploadEdmFile } from '@/lib/internal/oracle-epm-enterprise-data-management/files'
import { startEdmJob } from '@/lib/internal/oracle-epm-enterprise-data-management/jobs'
import { edmAttachmentLink } from '@/lib/internal/oracle-epm-enterprise-data-management/links'
import { projectEdmList } from '@/lib/internal/oracle-epm-enterprise-data-management/operations/discovery'
import {
  edmLineageSchema,
  edmPageSchema,
  edmRequestSchema,
} from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import {
  type EdmInput,
  type EdmOperationContext,
  edmJsonData,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

export async function createEdmRequest(
  input: EdmInput<'create_request'>,
  context: EdmOperationContext
) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.createRequest, {
      json: filterUndefined({
        viewUri: `${context.instanceUrl}/epm/rest/v1/views/${encodeURIComponent(input.viewId)}`,
        origin: 'INTERACTIVE',
        title: input.title,
        description: input.description,
        notes: input.notes,
        priority: input.priority,
        timeLabelName: input.timeLabelName,
      }),
      signal: context.signal,
    })
  )
  return { request: edmRequestSchema.parse(data) }
}

export async function getEdmRequest(input: EdmInput<'get_request'>, context: EdmOperationContext) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.request, {
      pathParams: { requestId: input.requestId },
      signal: context.signal,
    })
  )
  return { request: edmRequestSchema.parse(data) }
}

export async function queryEdmRequests(
  input: EdmInput<'query_requests'>,
  context: EdmOperationContext
) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.queryRequests, {
      query: {
        lastDays: input.fromDate === undefined ? (input.lastDays ?? 30) : undefined,
        fromDate: input.fromDate,
        toDate: input.toDate,
        myActivity: input.myActivity,
        owner: input.owner,
        priority: input.priority,
        requestNumber: input.requestNumber?.toString(),
        requestType: input.requestType,
        stage: input.stage,
        status: input.status,
        timeLabelName: input.timeLabelName,
        viewName: input.viewName,
        expand: input.expandWorkflow ? 'workflow' : undefined,
      },
      signal: context.signal,
    })
  )
  const page = edmPageSchema(edmRequestSchema).parse(data)
  return { requests: projectEdmList(page.items, input.maxResults, page.hasMore ?? false) }
}

export async function getEdmRequestLineage(
  input: EdmInput<'get_request_lineage'>,
  context: EdmOperationContext
) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.lineage, {
      pathParams: { requestId: input.requestId },
      signal: context.signal,
    })
  )
  return { lineage: edmLineageSchema.parse(data) }
}

export async function assignEdmRequest(
  input: EdmInput<'assign_request'>,
  context: EdmOperationContext
) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.assignRequest, {
      json: filterUndefined({
        requestNumber: input.requestNumber,
        userName: input.userName,
        comment: input.comment,
      }),
      signal: context.signal,
    })
  )
  return { request: edmRequestSchema.parse(data) }
}

export async function deleteEdmRequest(
  input: EdmInput<'delete_request'>,
  context: EdmOperationContext
) {
  await context.client.request(edmEndpoints.deleteRequest, {
    pathParams: { requestId: input.requestId },
    signal: context.signal,
  })
  return { requestId: input.requestId, deleted: true }
}

export async function uploadEdmRequestAttachment(
  input: EdmInput<'upload_request_attachment'>,
  context: EdmOperationContext
) {
  const response = await uploadEdmFile(
    edmEndpoints.uploadAttachment,
    input.file,
    input.fileName,
    context,
    { requestId: input.requestId }
  )
  return {
    requestId: input.requestId,
    fileName: response.fileName,
    ...edmAttachmentLink(context.client, response.data, input.requestId),
  }
}

export async function generateEdmRequestAttachment(
  input: EdmInput<'generate_request_attachment'>,
  context: EdmOperationContext
) {
  return startEdmJob(
    edmEndpoints.generateAttachment,
    filterUndefined({
      fileName: input.fileName,
      items: input.items,
      overwrite: input.overwrite,
    }),
    input,
    context,
    { requestId: input.requestId }
  )
}

export async function importEdmRequestAttachment(
  input: EdmInput<'import_request_attachment'>,
  context: EdmOperationContext
) {
  return startEdmJob(
    edmEndpoints.importAttachment,
    {
      attachmentUri: `${context.instanceUrl}/epm/rest/v1/requests/${encodeURIComponent(input.requestId)}/attachments/${encodeURIComponent(input.attachmentId)}`,
      sheetNames: input.sheetNames,
    },
    input,
    context,
    { requestId: input.requestId }
  )
}

export async function transitionEdmRequest(
  input: EdmInput<'transition_request'>,
  context: EdmOperationContext
) {
  return startEdmJob(
    edmEndpoints.transitionRequest,
    filterUndefined({
      action: input.action,
      comment: input.comment,
      transitionWithWarning: input.transitionWithWarning,
    }),
    input,
    context,
    { requestId: input.requestId }
  )
}
