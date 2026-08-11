import { v2OrchestrationErrorPolicy } from '@/lib/api/server/routes'

export const v2LogErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
} as const
