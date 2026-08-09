import {
  createV2ResourceConcealmentPolicy,
  type V2ErrorPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { WorkflowImportError } from '@/lib/workflows/application/workflow-import-error'
import { v2CaughtOrchestrationError, v2ErrorForOrchestration } from '@/app/api/v2/lib/response'

export const v2WorkflowErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  import: {
    render(error) {
      if (error instanceof WorkflowImportError) {
        return v2ErrorForOrchestration(error.code, error.message, error.details)
      }
      return v2CaughtOrchestrationError(error)
    },
  } satisfies V2ErrorPolicy,
  concealWorkflowAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Workflow not found',
  }),
  concealRunAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Run not found',
  }),
} as const
