import { filterUndefined } from '@sim/utils/object'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { downloadNarrativeOutput } from '@/lib/internal/oracle-epm-narrative-reporting/operations/files'
import { submitNarrativeJob } from '@/lib/internal/oracle-epm-narrative-reporting/operations/jobs'
import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'
import {
  type NarrativeDownloadInput,
  type NarrativeListInput,
  type NarrativeResourceInput,
  type NarrativeSnapshotInput,
  narrativePageSchema,
  narrativeReportSchema,
  parseNarrativeJson,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'

const FIELDS =
  'reportId,name,description,createdBy,creationDate,modifiedDate,lastAccessed,instanceType,datasourceNames'

export async function listReportSnapshots(
  input: NarrativeListInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.listSnapshots, {
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
  return { success: true, output: { snapshots: items, ...page } }
}

export async function getReportSnapshot(
  input: NarrativeResourceInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.getSnapshot, {
    pathParams: { id: input.resourceId },
    query: { fields: FIELDS },
    signal: context.signal,
  })
  return {
    success: true,
    output: { snapshot: parseNarrativeJson(narrativeReportSchema, response) },
  }
}

export async function downloadReportSnapshotOutput(
  input: NarrativeDownloadInput,
  context: NarrativeOperationContext
) {
  return downloadNarrativeOutput(
    context,
    narrativeEndpoints.downloadSnapshot,
    input,
    { format: input.format },
    ['application/octet-stream']
  )
}

export async function createReportSnapshot(
  input: NarrativeSnapshotInput,
  context: NarrativeOperationContext
) {
  return submitNarrativeJob(
    'CREATE_REPORT_SNAPSHOT',
    filterUndefined({
      reportId: input.reportId,
      reportName: input.reportName,
      prompts: input.prompts,
      globalPov: input.globalPov,
      libraryLocation: input.libraryLocation,
      snapShotName: input.snapShotName,
      overwrite: input.overwrite,
    }),
    context
  )
}
