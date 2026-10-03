import { filterUndefined } from '@sim/utils/object'
import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import { startEdmJob } from '@/lib/internal/oracle-epm-enterprise-data-management/jobs'
import type {
  EdmInput,
  EdmOperationContext,
} from '@/lib/internal/oracle-epm-enterprise-data-management/types'

export async function validateEdmViewpoint(
  input: EdmInput<'validate_viewpoint'>,
  context: EdmOperationContext
) {
  return startEdmJob(
    edmEndpoints.validateViewpoint,
    filterUndefined({
      viewName: input.viewName,
      viewpointName: input.viewpointName,
      fileName: input.fileName,
      requestNumber: input.requestNumber,
    }),
    input,
    context,
    undefined,
    input.fileName
  )
}
