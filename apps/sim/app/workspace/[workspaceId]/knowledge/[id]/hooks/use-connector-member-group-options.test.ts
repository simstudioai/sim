/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/queries/credential-groups', () => ({ useCredentialGroups: vi.fn() }))

import { connectorMemberGroupProvider } from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-member-group-options'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import type { ConnectorMeta } from '@/connectors/types'

const permissionScoped = Object.values(CONNECTOR_META_REGISTRY).filter(
  (meta) => meta.permissionScopedListing !== undefined
)

describe('connectorMemberGroupProvider', () => {
  it.each(permissionScoped.map((meta) => [meta.id, meta] as const))(
    'resolves %s, so its Access control renders',
    (_id, meta) => {
      expect(connectorMemberGroupProvider(meta)).not.toBeNull()
    }
  )

  /**
   * Slack authorizes through the workspace's own app rather than Sim's OAuth
   * client. Resolving only the providers Sim owns a client for left it with no
   * way into per-member access and no way back out of it.
   */
  it('resolves Slack, which no standard OAuth client backs', () => {
    const slack = CONNECTOR_META_REGISTRY.slack
    expect(slack.permissionScopedListing).toBeDefined()
    expect(connectorMemberGroupProvider(slack)).toBe('slack')
  })

  it('resolves nothing for a connector no Credential Group collects accounts for', () => {
    const sftp = CONNECTOR_META_REGISTRY.sftp
    expect(connectorMemberGroupProvider(sftp)).toBeNull()
  })

  it('resolves nothing for a connector whose listing is not permission scoped', () => {
    const withoutScopedListing = {
      ...CONNECTOR_META_REGISTRY.slack,
      permissionScopedListing: undefined,
    } as ConnectorMeta
    expect(connectorMemberGroupProvider(withoutScopedListing)).toBeNull()
  })
})
