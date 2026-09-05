import { filterUndefined } from '@sim/utils/object'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { submitNarrativeJob } from '@/lib/internal/oracle-epm-narrative-reporting/operations/jobs'
import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'
import {
  type NarrativeRefreshInput,
  type NarrativeResourceInput,
  narrativeReportPackageSchema,
  parseNarrativeJson,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'

export async function getReportPackage(
  input: NarrativeResourceInput,
  context: NarrativeOperationContext
) {
  const response = await context.client.request(narrativeEndpoints.getReportPackage, {
    pathParams: { id: input.resourceId },
    query: { fields: 'all' },
    signal: context.signal,
  })
  return {
    success: true,
    output: { reportPackage: parseNarrativeJson(narrativeReportPackageSchema, response) },
  }
}

export async function refreshReportPackageDataSources(
  input: NarrativeRefreshInput,
  context: NarrativeOperationContext
) {
  return submitNarrativeJob(
    'REFRESH_RP_DS',
    filterUndefined({
      reportPackageName: input.reportPackageName,
      refreshableSources: input.refreshableSources,
    }),
    context
  )
}
