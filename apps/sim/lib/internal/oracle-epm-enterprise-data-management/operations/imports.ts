import { filterUndefined } from '@sim/utils/object'
import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import { uploadEdmFile } from '@/lib/internal/oracle-epm-enterprise-data-management/files'
import { startEdmJob } from '@/lib/internal/oracle-epm-enterprise-data-management/jobs'
import { validateEdmStagingLink } from '@/lib/internal/oracle-epm-enterprise-data-management/links'
import type {
  EdmInput,
  EdmOperationContext,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

async function stageFile(
  input: { file?: unknown; fileName: string },
  context: EdmOperationContext
) {
  if (input.file === undefined) return
  const result = await uploadEdmFile(
    edmEndpoints.uploadStaging,
    input.file,
    input.fileName,
    context
  )
  validateEdmStagingLink(context.client, result.data, input.fileName)
}

export async function importEdmDimension(
  input: EdmInput<'import_dimension'>,
  context: EdmOperationContext
) {
  await stageFile(input, context)
  return startEdmJob(
    edmEndpoints.importDimension,
    filterUndefined({
      applicationName: input.applicationName,
      dimensionName: input.dimensionName,
      fileName: input.fileName,
      importOption: input.importOption,
      connection: input.connection,
    }),
    input,
    context
  )
}

export async function loadEdmViewpoint(
  input: EdmInput<'load_viewpoint'>,
  context: EdmOperationContext
) {
  await stageFile(input, context)
  return startEdmJob(
    edmEndpoints.loadViewpoint,
    {
      viewName: input.viewName,
      viewpointName: input.viewpointName,
      fileName: input.fileName,
      purpose: input.purpose,
      loadOption: input.loadOption,
    },
    input,
    context
  )
}
