import { createLogger } from '@sim/logger'
import { afterEach, beforeEach, vi } from 'vitest'

const logger = createLogger('IntegrationTestSetup')

const disallowMock = (method: string) =>
  ((..._args: unknown[]) => {
    throw new Error(`Mocks are disabled in integration tests (${method})`)
  }) as unknown

Object.assign(vi, {
  mock: disallowMock('vi.mock'),
  doMock: disallowMock('vi.doMock'),
  unmock: disallowMock('vi.unmock'),
  spyOn: disallowMock('vi.spyOn'),
  fn: disallowMock('vi.fn'),
  mocked: disallowMock('vi.mocked'),
  stubGlobal: disallowMock('vi.stubGlobal'),
  stubEnv: disallowMock('vi.stubEnv'),
})

beforeEach(async () => {
  // logger.debug('Starting integration test transaction')
  // await dbClient.unsafe('BEGIN')
})

afterEach(async () => {
  // logger.debug('Rolling back integration test transaction')
  // await dbClient.unsafe('ROLLBACK')
})
