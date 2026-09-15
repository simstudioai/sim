import { resolveMigrationDatabaseUrl } from '@sim/db/script-migrations/database-url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const applicationUrl = 'postgresql://application.invalid/application'
const migrationUrl = 'postgresql://migration.invalid/migrations'

describe('standalone migration database URL', () => {
  afterEach(() => vi.unstubAllEnvs())

  it.each([
    { direct: undefined, application: applicationUrl, expected: applicationUrl },
    { direct: '', application: applicationUrl, expected: applicationUrl },
    { direct: migrationUrl, application: applicationUrl, expected: migrationUrl },
    { direct: migrationUrl, application: undefined, expected: migrationUrl },
    { direct: undefined, application: undefined, expected: undefined },
    { direct: '', application: '', expected: '' },
  ])(
    'resolves direct=$direct and application=$application',
    ({ direct, application, expected }) => {
      vi.stubEnv('MIGRATION_DATABASE_URL', direct)
      vi.stubEnv('DATABASE_URL', application)

      expect(resolveMigrationDatabaseUrl()).toBe(expected)
    }
  )
})
