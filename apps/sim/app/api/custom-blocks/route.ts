import {
  listCustomBlocksContract,
  publishCustomBlockContract,
} from '@/lib/api/contracts/custom-blocks'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  customBlockSettingsOperations,
  listCustomBlockSettings,
  publishCustomBlockSettings,
} from '@/lib/workflows/custom-blocks/application/settings'
import { customBlockError } from '@/app/api/custom-blocks/errors'

export const GET = defineInternalJsonRoute({
  contract: listCustomBlocksContract,
  auth: internalSessionAuth,
  operation: customBlockSettingsOperations.list,
  rateLimit: internalRateLimits.none({ reason: 'Preserve existing custom block listing policy.' }),
  errorPolicy: { project: (error) => customBlockError(error, true) },
  mapInput: ({ query }) => query,
  useCase: listCustomBlockSettings,
})

export const POST = defineInternalJsonRoute({
  contract: publishCustomBlockContract,
  auth: internalSessionAuth,
  operation: customBlockSettingsOperations.publish,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing custom block publishing policy.',
  }),
  errorPolicy: { project: customBlockError },
  mapInput: ({ body }) => body,
  useCase: publishCustomBlockSettings,
})
