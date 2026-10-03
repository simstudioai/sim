import { describe, expect, it } from 'vitest'
import { resolveWorkspaceSwitchHref } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks/use-workspace-management'

describe('resolveWorkspaceSwitchHref', () => {
  it('drops workspace-scoped settings detail segments', () => {
    expect(
      resolveWorkspaceSwitchHref({
        pathname: '/workspace/workspace-a/settings/secrets/credential-a',
        currentWorkspaceId: 'workspace-a',
        targetWorkspaceId: 'workspace-b',
      })
    ).toBe('/workspace/workspace-b/settings/secrets')
  })
})
