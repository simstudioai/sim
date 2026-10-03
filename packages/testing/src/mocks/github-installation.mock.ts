import { vi } from 'vitest'

/**
 * Stand-in for `GitHubInstallationError` from `@/lib/oauth/github-installation`: same `name` and
 * constructor `(message, status?, operation?)`.
 */
export class MockGitHubInstallationError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly operation?: string
  ) {
    super(message)
    this.name = 'GitHubInstallationError'
  }
}

/**
 * Controllable mock functions for `@/lib/oauth/github-installation`. Every function is a bare
 * `vi.fn()` (binding parsing and configuration depend on zod and env, so tests set them).
 *
 * @example
 * ```ts
 * import { githubInstallationMockFns } from '@sim/testing/mocks/github-installation.mock'
 *
 * githubInstallationMockFns.mockParseGitHubInstallationBinding.mockReturnValue(binding)
 * ```
 */
export const githubInstallationMockFns = {
  mockGetGitHubInstallationConfiguration: vi.fn(),
  mockParseGitHubInstallationBinding: vi.fn(),
  mockListUserAdminGitHubInstallations: vi.fn(),
  mockAssertGitHubInstallationActive: vi.fn(),
  mockAssertGitHubInstallationRepositoryActive: vi.fn(),
  mockVerifyGitHubInstallationBinding: vi.fn(),
  mockResolveGitHubInstallationRepository: vi.fn(),
  mockListGitHubInstallationRepositories: vi.fn(),
  mockResolveGitHubInstallationAccessToken: vi.fn(),
}

const fns = githubInstallationMockFns

/**
 * Static mock module for `@/lib/oauth/github-installation`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/oauth/github-installation', () => githubInstallationMock)
 * ```
 */
export const githubInstallationMock = {
  GitHubInstallationError: MockGitHubInstallationError,
  getGitHubInstallationConfiguration: fns.mockGetGitHubInstallationConfiguration,
  parseGitHubInstallationBinding: fns.mockParseGitHubInstallationBinding,
  listUserAdminGitHubInstallations: fns.mockListUserAdminGitHubInstallations,
  assertGitHubInstallationActive: fns.mockAssertGitHubInstallationActive,
  assertGitHubInstallationRepositoryActive: fns.mockAssertGitHubInstallationRepositoryActive,
  verifyGitHubInstallationBinding: fns.mockVerifyGitHubInstallationBinding,
  resolveGitHubInstallationRepository: fns.mockResolveGitHubInstallationRepository,
  listGitHubInstallationRepositories: fns.mockListGitHubInstallationRepositories,
  resolveGitHubInstallationAccessToken: fns.mockResolveGitHubInstallationAccessToken,
}
