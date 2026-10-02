import { envBoolean, getEnv } from '@/lib/core/config/env'
import { HttpError } from '@/lib/core/utils/http-error'

/** Deployment-wide controls; existing Project lifecycle maintenance never depends on these. */
export function getProjectRollout() {
  const writesEnabled = envBoolean(getEnv('PROJECT_WRITES_ENABLED')) ?? false
  const apiEnabled = envBoolean(getEnv('PROJECT_API_ENABLED')) ?? false
  if (apiEnabled && !writesEnabled)
    throw new Error('PROJECT_API_ENABLED requires PROJECT_WRITES_ENABLED')
  return { writesEnabled, apiEnabled }
}

class ProjectUnavailableError extends HttpError {
  readonly statusCode = 503
  constructor() {
    super('Projects are not enabled on this deployment')
  }
}

export function requireProjectApiEnabled(): void {
  if (!getProjectRollout().apiEnabled) throw new ProjectUnavailableError()
}
