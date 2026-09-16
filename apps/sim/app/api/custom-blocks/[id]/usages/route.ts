import { getCustomBlockUsageCountsContract } from '@/lib/api/contracts/custom-blocks'
import {
  defineInternalJsonRoute,
  internalRateLimits,
  internalSessionAuth,
} from '@/lib/api/server/routes'
import {
  customBlockSettingsOperations,
  readCustomBlockUsages,
} from '@/lib/workflows/custom-blocks/application/settings'
import { customBlockError } from '@/app/api/custom-blocks/errors'

export const GET = defineInternalJsonRoute({
  contract: getCustomBlockUsageCountsContract,
  auth: internalSessionAuth,
  operation: customBlockSettingsOperations.usages,
  rateLimit: internalRateLimits.none({
    reason: 'Preserve existing custom block usage read policy.',
  }),
  errorPolicy: { project: customBlockError },
  mapInput: ({ params }) => params,
  useCase: readCustomBlockUsages,
})
