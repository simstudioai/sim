import {
  assertLoopbackPostgresUrl,
  assertSafeDatabaseName,
  createRunDatabaseName,
} from './database'
import { E2E_ORIGIN, E2E_PROFILE } from './deployment-profile'

export function assertSafeSeedEnvironment(environment: {
  E2E_ORCHESTRATED: string
  E2E_PROFILE: string
  E2E_RUN_ID: string
  E2E_BASE_URL: string
  DATABASE_URL: string
}): void {
  if (environment.E2E_ORCHESTRATED !== '1') {
    throw new Error('seed-world must run under the guarded E2E orchestrator')
  }
  if (environment.E2E_PROFILE !== E2E_PROFILE) {
    throw new Error(`seed-world requires profile ${E2E_PROFILE}`)
  }
  if (environment.E2E_BASE_URL !== E2E_ORIGIN) {
    throw new Error(`seed-world requires origin ${E2E_ORIGIN}`)
  }
  const databaseUrl = assertLoopbackPostgresUrl(environment.DATABASE_URL)
  const databaseName = decodeURIComponent(databaseUrl.pathname.replace(/^\//, ''))
  assertSafeDatabaseName(databaseName)
  const expectedName = createRunDatabaseName(environment.E2E_RUN_ID)
  if (databaseName !== expectedName) {
    throw new Error(
      `seed-world database ${databaseName} does not match guarded run ${environment.E2E_RUN_ID}`
    )
  }
}
