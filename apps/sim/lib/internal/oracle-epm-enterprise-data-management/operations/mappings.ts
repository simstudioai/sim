import { filterUndefined } from '@sim/utils/object'
import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import { startEdmJob } from '@/lib/internal/oracle-epm-enterprise-data-management/jobs'
import { edmMappingKeysSchema } from '@/lib/internal/oracle-epm-enterprise-data-management/schemas'
import {
  type EdmInput,
  type EdmOperationContext,
  edmJsonData,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

export async function getEdmMappingKeys(
  input: EdmInput<'get_mapping_keys'>,
  context: EdmOperationContext
) {
  const data = edmJsonData(
    await context.client.request(edmEndpoints.mappingKeys, {
      pathParams: { dimensionId: input.dimensionId, bindingId: input.bindingId },
      signal: context.signal,
    })
  )
  return edmMappingKeysSchema.parse(data)
}

export async function exportEdmMappings(
  input: EdmInput<'export_mappings'>,
  context: EdmOperationContext
) {
  return startEdmJob(
    edmEndpoints.exportMappings,
    filterUndefined({
      applicationName: input.applicationName,
      dimensionName: input.dimensionName,
      fileName: input.fileName,
      mappingLocation: input.mappingLocation,
      connection: input.connection,
    }),
    input,
    context,
    undefined,
    input.connection ? undefined : input.fileName
  )
}
