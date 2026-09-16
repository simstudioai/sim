import {
  extendInternalErrorPolicy,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { isZodError, serializeZodIssues } from '@/lib/api/server/validation'

/** Preserves destination-validator issue details for the authenticated Settings UI. */
export const dataDrainRouteErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) =>
    isZodError(error)
      ? { status: 400, body: { error: 'Validation error', details: serializeZodIssues(error) } }
      : null
)
