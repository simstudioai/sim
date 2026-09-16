import {
  deleteCustomBlockContract,
  updateCustomBlockContract,
} from '@/lib/api/contracts/custom-blocks'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  customBlockSettingsOperations,
  deleteCustomBlockSettings,
  updateCustomBlockSettings,
} from '@/lib/workflows/custom-blocks/application/settings'
import { customBlockError } from '@/app/api/custom-blocks/errors'

export const PATCH = defineInternalJsonRoute({
  contract: updateCustomBlockContract,
  auth: internalSessionAuth,
  operation: customBlockSettingsOperations.update,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing custom block update policy.' }),
  errorPolicy: { project: customBlockError },
  mapInput: ({ params, body }) => ({ id: params.id, patch: body }),
  useCase: updateCustomBlockSettings,
})

export const DELETE = defineInternalJsonRoute({
  contract: deleteCustomBlockContract,
  auth: internalSessionAuth,
  operation: customBlockSettingsOperations.delete,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing custom block deletion policy.' }),
  errorPolicy: { project: customBlockError },
  mapInput: ({ params }) => params,
  useCase: deleteCustomBlockSettings,
  present: () => ({ success: true as const }),
})
