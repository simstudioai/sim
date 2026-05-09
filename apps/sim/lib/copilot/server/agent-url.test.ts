import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMothershipBaseURL } from './agent-url'

const { dbMock, mockRows } = vi.hoisted(() => {
  const mockRows: any[] = []
  const dbMock = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => mockRows),
          })),
        })),
      })),
    })),
  }
  return { dbMock, mockRows }
})

vi.mock('@sim/db', () => ({ db: dbMock }))
vi.mock('@sim/db/schema', () => ({
  settings: {
    userId: 'settings.userId',
    superUserModeEnabled: 'settings.superUserModeEnabled',
    mothershipEnvironment: 'settings.mothershipEnvironment',
  },
  user: {
    id: 'user.id',
    role: 'user.role',
  },
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => ({})),
}))
vi.mock('@/lib/api/contracts', () => ({
  mothershipEnvironmentSchema: {
    safeParse: (value: unknown) =>
      ['default', 'dev', 'staging', 'prod'].includes(String(value))
        ? { success: true, data: value }
        : { success: false },
  },
}))
vi.mock('@/lib/copilot/constants', () => ({
  SIM_AGENT_API_URL: 'https://default.mothership.test',
  SIM_AGENT_API_URL_DEFAULT: 'https://fallback.mothership.test',
}))
vi.mock('@/lib/core/config/env', () => ({
  env: {
    COPILOT_DEV_URL: 'https://dev.mothership.test',
    COPILOT_STAGING_URL: 'https://staging.mothership.test',
    COPILOT_PROD_URL: 'https://prod.mothership.test',
  },
}))

describe('getMothershipBaseURL', () => {
  beforeEach(() => {
    mockRows.length = 0
    dbMock.select.mockClear()
  })

  it('uses the default URL when there is no user context', async () => {
    await expect(getMothershipBaseURL()).resolves.toBe('https://default.mothership.test')
    await expect(getMothershipBaseURL({ environment: 'dev' })).resolves.toBe(
      'https://default.mothership.test'
    )
  })

  it('ignores stored and explicit environments for non-admin users', async () => {
    mockRows.push({
      role: 'user',
      superUserModeEnabled: true,
      mothershipEnvironment: 'dev',
    })

    await expect(getMothershipBaseURL({ userId: 'user-1', environment: 'staging' })).resolves.toBe(
      'https://default.mothership.test'
    )
  })

  it('ignores stored and explicit environments when super user mode is off', async () => {
    mockRows.push({
      role: 'admin',
      superUserModeEnabled: false,
      mothershipEnvironment: 'dev',
    })

    await expect(getMothershipBaseURL({ userId: 'admin-1', environment: 'prod' })).resolves.toBe(
      'https://default.mothership.test'
    )
  })

  it('uses default for super admins until they select a concrete environment', async () => {
    mockRows.push({
      role: 'admin',
      superUserModeEnabled: true,
      mothershipEnvironment: 'default',
    })

    await expect(getMothershipBaseURL({ userId: 'admin-1' })).resolves.toBe(
      'https://default.mothership.test'
    )
  })

  it('allows effective super admins to use a selected environment', async () => {
    mockRows.push({
      role: 'admin',
      superUserModeEnabled: true,
      mothershipEnvironment: 'dev',
    })

    await expect(getMothershipBaseURL({ userId: 'admin-1' })).resolves.toBe(
      'https://dev.mothership.test'
    )
    await expect(getMothershipBaseURL({ userId: 'admin-1', environment: 'staging' })).resolves.toBe(
      'https://staging.mothership.test'
    )
  })
})
