import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/secrets/application/use-cases`. Every function is a bare
 * `vi.fn()`. Each use case is exposed as its `execute` knob (`mock<UseCase>`) and its `authorize`
 * knob (`mock<UseCase>Authorize`).
 *
 * @example
 * ```ts
 * import { secretsUseCasesMockFns } from '@sim/testing/mocks/secrets-use-cases.mock'
 *
 * secretsUseCasesMockFns.mockListSecretsUseCase.mockResolvedValue({ secrets: [] })
 * ```
 */
export const secretsUseCasesMockFns = {
  mockListSecretsUseCase: vi.fn(),
  mockListSecretsUseCaseAuthorize: vi.fn(),
  mockSetSecretUseCase: vi.fn(),
  mockSetSecretUseCaseAuthorize: vi.fn(),
  mockDeleteSecretUseCase: vi.fn(),
  mockDeleteSecretUseCaseAuthorize: vi.fn(),
  mockListSecretUsageUseCase: vi.fn(),
  mockListSecretUsageUseCaseAuthorize: vi.fn(),
  mockListSecretReferencesUseCase: vi.fn(),
  mockListSecretReferencesUseCaseAuthorize: vi.fn(),
}

const fns = secretsUseCasesMockFns

/**
 * Static mock module for `@/lib/secrets/application/use-cases`. Each use case is
 * `{ operation: { id }, delegationAudience: 'sim:secrets', authorize, execute }` with the real
 * operation id and delegation audience.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/secrets/application/use-cases', () => secretsUseCasesMock)
 * ```
 */
export const secretsUseCasesMock = {
  listSecretsUseCase: {
    operation: { id: 'secrets.list' },
    delegationAudience: 'sim:secrets',
    authorize: fns.mockListSecretsUseCaseAuthorize,
    execute: fns.mockListSecretsUseCase,
  },
  setSecretUseCase: {
    operation: { id: 'secrets.set' },
    delegationAudience: 'sim:secrets',
    authorize: fns.mockSetSecretUseCaseAuthorize,
    execute: fns.mockSetSecretUseCase,
  },
  deleteSecretUseCase: {
    operation: { id: 'secrets.delete' },
    delegationAudience: 'sim:secrets',
    authorize: fns.mockDeleteSecretUseCaseAuthorize,
    execute: fns.mockDeleteSecretUseCase,
  },
  listSecretUsageUseCase: {
    operation: { id: 'secrets.usage' },
    delegationAudience: 'sim:secrets',
    authorize: fns.mockListSecretUsageUseCaseAuthorize,
    execute: fns.mockListSecretUsageUseCase,
  },
  listSecretReferencesUseCase: {
    operation: { id: 'secrets.references' },
    delegationAudience: 'sim:secrets',
    authorize: fns.mockListSecretReferencesUseCaseAuthorize,
    execute: fns.mockListSecretReferencesUseCase,
  },
}
