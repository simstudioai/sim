import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { HttpError } from '@/lib/core/utils/http-error'

class ProjectUnavailableError extends HttpError {
  readonly statusCode = 503
  constructor() {
    super('Projects are not enabled on this deployment')
  }
}

/** Project rollout is a global switch; it never varies by organization or user. */
export function isProjectsEnabled(): Promise<boolean> {
  return isFeatureEnabled('projects')
}

export async function requireProjectApiEnabled(): Promise<void> {
  if (!(await isProjectsEnabled())) throw new ProjectUnavailableError()
}
