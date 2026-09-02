/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceMemberConnector } from '@/hooks/queries/kb/connectors'

vi.mock('@/hooks/queries/kb/connectors', () => ({ useWorkspaceMemberConnectors: vi.fn() }))
vi.mock('@/hooks/queries/kb/knowledge', () => ({
  useKnowledgeBasesQuery: vi.fn(),
  useWorkspaceKnowledgeSearch: vi.fn(),
}))
vi.mock('@/app/workspace/[workspaceId]/providers/workspace-host-provider', () => ({
  useWorkspaceHostContext: vi.fn(),
}))
vi.mock(
  '@/app/workspace/[workspaceId]/home/components/message-content/components/source-card',
  () => ({ SourceCard: () => null })
)

import { indexingSourceNames } from '@/app/workspace/[workspaceId]/home/components/knowledge-search-results/knowledge-search-results'

function memberConnector(
  overrides: Partial<WorkspaceMemberConnector> = {}
): WorkspaceMemberConnector {
  return {
    knowledgeBaseId: 'kb-1',
    knowledgeBaseName: 'Sim Search',
    connectorId: 'connector-1',
    connectorType: 'google_drive',
    memberSyncStatus: 'running',
    viewerMembership: 'connected',
    viewerDocumentCount: 0,
    ...overrides,
  }
}

describe('indexingSourceNames', () => {
  it('names each source still indexing for the viewer once, in the searched bases only', () => {
    const names = indexingSourceNames(
      [
        memberConnector({ connectorId: 'a', connectorType: 'google_drive' }),
        memberConnector({
          connectorId: 'b',
          connectorType: 'google_drive',
          knowledgeBaseId: 'kb-2',
        }),
        memberConnector({ connectorId: 'c', connectorType: 'slack', memberSyncStatus: 'pending' }),
        memberConnector({ connectorId: 'd', connectorType: 'notion', knowledgeBaseId: 'kb-3' }),
      ],
      ['kb-1', 'kb-2']
    )

    expect(names).toEqual(['Google Drive', 'Slack'])
  })

  it('ignores sources that are idle or not connected for the viewer', () => {
    expect(
      indexingSourceNames(
        [
          memberConnector({ connectorId: 'a', memberSyncStatus: 'idle' }),
          memberConnector({ connectorId: 'b', viewerMembership: 'invited' }),
        ],
        ['kb-1']
      )
    ).toEqual([])
  })
})
