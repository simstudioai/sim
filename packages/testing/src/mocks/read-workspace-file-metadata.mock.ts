import { vi } from 'vitest'

/** A copy of `fileOperations.readMetadata` from `@/lib/workspace-files/application/operations`. */
const FILES_READ_METADATA_OPERATION = {
  id: 'files.read_metadata',
  oauthScope: 'api:read',
  minimumRole: 'read',
  workspaceApiKey: 'allow',
  capability: 'files.use',
  contentDelivery: 'none',
  principalKinds: [
    'session',
    'personal_api_key',
    'oauth_access_token',
    'workspace_api_key',
    'delegated',
  ],
  delegatedServices: ['copilot', 'executor'],
} as const

/** `WORKSPACE_FILES_DELEGATION_AUDIENCE`, exposed by every workspace-file use case. */
const WORKSPACE_FILES_DELEGATION_AUDIENCE = 'sim:workspace-files'

/**
 * Controllable mock functions for `@/lib/workspace-files/application/read-workspace-file-metadata`.
 * Every function is a bare `vi.fn()`. Each use case is exposed as its `execute` knob
 * (`mock<UseCase>`) and its `authorize` knob (`mock<UseCase>Authorize`).
 *
 * @example
 * ```ts
 * import { readWorkspaceFileMetadataMockFns } from '@sim/testing/mocks/read-workspace-file-metadata.mock'
 *
 * readWorkspaceFileMetadataMockFns.mockReadWorkspaceFileMetadata.mockResolvedValue({ file, share: null })
 * ```
 */
export const readWorkspaceFileMetadataMockFns = {
  mockReadWorkspaceFileMetadata: vi.fn(),
  mockReadWorkspaceFileMetadataAuthorize: vi.fn(),
  mockReadWorkspaceFileMetadataWithVersion: vi.fn(),
  mockReadWorkspaceFileMetadataWithVersionAuthorize: vi.fn(),
}

const fns = readWorkspaceFileMetadataMockFns

/**
 * Static mock module for `@/lib/workspace-files/application/read-workspace-file-metadata`. Each use
 * case is `{ operation, delegationAudience, authorize, execute }` with a copy of the real
 * `files.read_metadata` operation; a test whose code checks operation identity through a Copilot
 * adapter spreads this mock and substitutes the real operation.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/workspace-files/application/read-workspace-file-metadata', () => readWorkspaceFileMetadataMock)
 * ```
 */
export const readWorkspaceFileMetadataMock = {
  readWorkspaceFileMetadata: {
    operation: FILES_READ_METADATA_OPERATION,
    delegationAudience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    authorize: fns.mockReadWorkspaceFileMetadataAuthorize,
    execute: fns.mockReadWorkspaceFileMetadata,
  },
  readWorkspaceFileMetadataWithVersion: {
    operation: FILES_READ_METADATA_OPERATION,
    delegationAudience: WORKSPACE_FILES_DELEGATION_AUDIENCE,
    authorize: fns.mockReadWorkspaceFileMetadataWithVersionAuthorize,
    execute: fns.mockReadWorkspaceFileMetadataWithVersion,
  },
}
