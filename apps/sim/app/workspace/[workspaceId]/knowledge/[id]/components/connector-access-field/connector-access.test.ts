/**
 * `supported` is what decides whether the Access field renders at all, and it is
 * exactly `connectorMemberProvider(...) !== null`. A connector that declares
 * `permissionScopedListing` crawls once per member, so resolving it to `null`
 * hides per-member access from the one kind of connector that has it.
 *
 * @vitest-environment node
 */
import { assert, describe, expect, it } from 'vitest'
import { canConnectPersonally } from '@/lib/sim-search/connectors'
import {
  connectorMemberProvider,
  isConnectorFieldRequired,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/components/connector-access-field/connector-access'
import { gitlabConnectorMeta } from '@/connectors/gitlab/meta'
import {
  GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID,
  googleDriveConnectorMeta,
} from '@/connectors/google-drive/meta'
import { getAllConnectorMeta } from '@/connectors/registry'

const permissionScopedOAuthConnectors = Object.entries(getAllConnectorMeta()).filter(([, meta]) =>
  canConnectPersonally(meta)
)

describe('connectorMemberProvider', () => {
  /** A registry-driven `it.each([])` runs zero cases, so the suite must not be empty. */
  it('has permission-scoped OAuth connectors to check', () => {
    expect(permissionScopedOAuthConnectors.length).toBeGreaterThan(0)
  })

  it.each(permissionScopedOAuthConnectors)(
    'resolves a credential-group provider for %s',
    (_id, meta) => {
      expect(connectorMemberProvider(meta)).not.toBeNull()
    }
  )

  it('returns null for a connector that does not crawl per member', () => {
    const plain = Object.values(getAllConnectorMeta()).find(
      (meta) => meta.auth.mode === 'oauth' && !meta.permissionScopedListing
    )
    assert(plain)
    expect(connectorMemberProvider(plain)).toBeNull()
  })
})

describe('isConnectorFieldRequired', () => {
  it.each([
    ['admin', true],
    ['workspace', false],
  ] as const)('requires GitLab Host in %s mode: %s', (accessMode, required) => {
    const host = gitlabConnectorMeta.configFields.find((field) => field.id === 'host')
    assert(host)

    expect(isConnectorFieldRequired(host, gitlabConnectorMeta, accessMode)).toBe(required)
  })

  it.each([
    ['admin', true],
    ['workspace', false],
    ['members', false],
  ] as const)('preserves Drive subject requirements in %s mode: %s', (accessMode, required) => {
    const subject = googleDriveConnectorMeta.configFields.find(
      (field) => field.id === GOOGLE_DRIVE_ADMIN_EMAIL_FIELD_ID
    )
    assert(subject)

    expect(isConnectorFieldRequired(subject, googleDriveConnectorMeta, accessMode)).toBe(required)
  })
})
