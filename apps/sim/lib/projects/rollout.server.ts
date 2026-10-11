import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { HttpError } from '@/lib/core/utils/http-error'

class ProjectUnavailableError extends HttpError {
  readonly statusCode = 503
  constructor() {
    super('Projects are not enabled on this deployment')
  }
}

export async function requireProjectApiEnabled(): Promise<void> {
  if (!(await isFeatureEnabled('projects'))) throw new ProjectUnavailableError()
}
