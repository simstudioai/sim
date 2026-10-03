import { v2PreviewWorkflowImportContract } from '@/lib/api/contracts/v2/workflows'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api'
import { previewWorkflowImport } from '@/lib/workflows/application/mapped-import'
import { workflowOperations } from '@/lib/workflows/application/operations'
import { MAX_IMPORT_BODY_BYTES } from '@/lib/workflows/operations/import-workflow'

export const POST = defineV2JsonRoute({
  contract: v2PreviewWorkflowImportContract,
  auth: v2ApiKeyAuth,
  operation: workflowOperations.importPreview,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: v2WorkflowErrorPolicies.import,
  parseOptions: { maxBodyBytes: MAX_IMPORT_BODY_BYTES },
  mapInput: ({ body }) => body,
  useCase: previewWorkflowImport,
  present: (result) => ({ data: result }),
})
