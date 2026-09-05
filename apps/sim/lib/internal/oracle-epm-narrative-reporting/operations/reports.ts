import { z } from 'zod'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { downloadNarrativeOutput } from '@/lib/internal/oracle-epm-narrative-reporting/operations/files'
import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'
import {
  type NarrativeDownloadInput,
  type NarrativeListInput,
  type NarrativeResourceInput,
  narrativePageSchema,
  narrativePovSchema,
  narrativePromptSchema,
  narrativeReportSchema,
  parseNarrativeJson,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'

const FIELDS =
  'reportId,name,description,createdBy,creationDate,modifiedDate,lastAccessed,instanceType,datasourceNames'

export async function listReports(input: NarrativeListInput, context: NarrativeOperationContext) {
  const response = await context.client.request(narrativeEndpoints.listReports, {
    query: {
      fields: FIELDS,
      limit: input.limit,
      offset: input.offset,
      q: input.q,
      orderBy: input.orderBy,
    },
    signal: context.signal,
  })
  const { items, ...page } = parseNarrativeJson(
    narrativePageSchema(narrativeReportSchema),
    response
  )
  return { success: true, output: { reports: items, ...page } }
}

export async function getReport(input: NarrativeResourceInput, context: NarrativeOperationContext) {
  const response = await context.client.request(narrativeEndpoints.getReport, {
    pathParams: { id: input.resourceId },
    query: { fields: FIELDS },
    signal: context.signal,
  })
  return { success: true, output: { report: parseNarrativeJson(narrativeReportSchema, response) } }
}

export async function getReportGlobalPov(
  input: NarrativeResourceInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.getReportPov, {
    pathParams: { id: input.resourceId },
    signal: context.signal,
  })
  return {
    success: true,
    output: { dimensions: parseNarrativeJson(z.array(narrativePovSchema).max(100), response) },
  }
}

export async function getReportPrompts(
  input: NarrativeResourceInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.getReportPrompts, {
    pathParams: { id: input.resourceId },
    signal: context.signal,
  })
  return {
    success: true,
    output: { prompts: parseNarrativeJson(z.array(narrativePromptSchema).max(100), response) },
  }
}

export async function downloadReportOutput(
  input: NarrativeDownloadInput,
  context: NarrativeOperationContext
) {
  return downloadNarrativeOutput(
    context,
    narrativeEndpoints.downloadReport,
    input,
    {
      format: input.format,
      globalPov: input.globalPov,
      prompts: input.prompts,
    },
    ['application/pdf']
  )
}
