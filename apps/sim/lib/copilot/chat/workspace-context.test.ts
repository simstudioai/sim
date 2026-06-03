/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@sim/db', () => ({ db: {} }))
vi.mock('@sim/db/schema', () => ({
  knowledgeBase: {},
  knowledgeConnector: {},
  mcpServers: {},
  userTableDefinitions: {},
  userTableRows: {},
  workflow: {},
  workflowFolder: {},
  workflowSchedule: {},
}))

import { canonicalWorkflowVfsDir } from '@/lib/copilot/vfs/path-utils'
import { buildWorkspaceMd, type WorkspaceMdData } from './workspace-context'

function baseData(overrides: Partial<WorkspaceMdData> = {}): WorkspaceMdData {
  return {
    workspace: { id: 'ws-1', name: 'WS', ownerId: 'u-1' },
    members: [],
    workflows: [],
    knowledgeBases: [],
    tables: [],
    files: [],
    oauthIntegrations: [],
    envVariables: [],
    ...overrides,
  }
}

describe('buildWorkspaceMd - workflow VFS state paths', () => {
  // `workflows[].folderPath` arrives ALREADY per-segment percent-encoded (it is
  // the value from buildVfsFolderPathMap / resolveFolderPath that also builds the
  // stored VFS keys). The advertised path must not re-encode it.
  it('emits a single-encoded state path for a folder name with a space', () => {
    const md = buildWorkspaceMd(
      baseData({
        workflows: [
          { id: 'wf-1', name: 'The Elder', isDeployed: false, folderPath: 'The%20Elder' },
        ],
      })
    )

    expect(md).toContain('workflows/The%20Elder/The%20Elder/state.json')
    // The exact double-encoding regression: `%20` -> `%2520`.
    expect(md).not.toContain('The%2520Elder')
  })

  it('matches the canonical VFS dir helper the materializer/pointers use', () => {
    const folderPath = 'My%20Folder/Sub%20Folder'
    const md = buildWorkspaceMd(
      baseData({
        workflows: [{ id: 'wf-1', name: 'My Flow', isDeployed: false, folderPath }],
      })
    )

    const expected = `${canonicalWorkflowVfsDir({ name: 'My Flow', folderPath })}/state.json`
    expect(expected).toBe('workflows/My%20Folder/Sub%20Folder/My%20Flow/state.json')
    expect(md).toContain(expected)
  })

  it('does not advertise a VFS state path for root-level workflows', () => {
    const md = buildWorkspaceMd(
      baseData({
        workflows: [{ id: 'wf-1', name: 'Root Flow', isDeployed: false, folderPath: null }],
      })
    )

    expect(md).not.toContain('VFS state path')
  })
})
