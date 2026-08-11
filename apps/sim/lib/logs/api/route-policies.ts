import {
  createV2ResourceConcealmentPolicy,
  v2OrchestrationErrorPolicy,
} from '@/lib/api/server/routes'

export const v2LogErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  concealDetailAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Log not found',
  }),
} as const
