import { envBoolean, getEnv } from '@/lib/core/config/env'
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

/** Deployment-wide cutover follows ownership backfill and compatible storage/worker rollout. */
export async function isProjectFileApiEnabled(): Promise<boolean> {
  return (
    (await isFeatureEnabled('projects')) && (envBoolean(getEnv('PROJECT_FILES_ENABLED')) ?? false)
  )
}

export async function requireProjectFileApiEnabled(): Promise<void> {
  if (!(await isProjectFileApiEnabled())) throw new ProjectUnavailableError()
}
