import { filterUndefined } from '@sim/utils/object'
import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import { startEdmJob } from '@/lib/internal/oracle-epm-enterprise-data-management/jobs'
import type {
  EdmInput,
  EdmOperationContext,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

export async function exportEdmDimension(
  input: EdmInput<'export_dimension'>,
  context: EdmOperationContext
) {
  return startEdmJob(
    edmEndpoints.exportDimension,
    filterUndefined({
      applicationName: input.applicationName,
      dimensionName: input.dimensionName,
      fileName: input.fileName,
      connection: input.connection,
    }),
    input,
    context,
    undefined,
    input.connection ? undefined : input.fileName
  )
}

export async function incrementalExportEdmDimension(
  input: EdmInput<'incremental_export_dimension'>,
  context: EdmOperationContext
) {
  return startEdmJob(
    edmEndpoints.incrementalExport,
    filterUndefined({
      applicationName: input.applicationName,
      dimensionName: input.dimensionName,
      fileName: input.fileName,
      bindingNames: input.bindingNames,
      nodeChangeTypes: input.nodeChangeTypes,
      since: input.since,
      sinceLastExportOfType: input.sinceLastExportOfType,
      connectionName: input.connectionName,
    }),
    input,
    context,
    undefined,
    input.connectionName ? undefined : input.fileName
  )
}

export async function extractEdmDimensionViewpoint(
  input: EdmInput<'extract_dimension_viewpoint'>,
  context: EdmOperationContext
) {
  return startEdmJob(
    edmEndpoints.extractViewpoint,
    filterUndefined({
      applicationName: input.applicationName,
      dimensionName: input.dimensionName,
      fileName: input.fileName,
      extractName: input.extractName,
      connection: input.connection,
      fromTime: input.fromTime,
      toTime: input.toTime,
      requestNumber: input.requestNumber,
    }),
    input,
    context,
    undefined,
    input.connection ? undefined : input.fileName
  )
}
