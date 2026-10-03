import { envBoolean, getEnv } from '@/lib/core/config/env'
import { HttpError } from '@/lib/core/utils/http-error'

class ProjectUnavailableError extends HttpError {
  readonly statusCode = 503
  constructor() {
    super('Projects are not enabled on this deployment')
  }
}

export function requireProjectApiEnabled(): void {
  if (!(envBoolean(getEnv('PROJECT_API_ENABLED')) ?? false)) throw new ProjectUnavailableError()
}
