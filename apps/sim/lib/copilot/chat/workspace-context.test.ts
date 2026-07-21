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
import { buildVfsSnapshot, buildWorkspaceMd, type WorkspaceMdData } from './workspace-context'

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

  it('advertises canonical encoded VFS paths for root-level workflows', () => {
    const md = buildWorkspaceMd(
      baseData({
        workflows: [{ id: 'wf-1', name: 'Root Flow', isDeployed: false, folderPath: null }],
      })
    )

    expect(md).toContain('VFS dir: `workflows/Root%20Flow`')
    expect(md).toContain('VFS state path: `workflows/Root%20Flow/state.json`')
  })

  it('never exposes workflow descriptions in markdown or the typed snapshot', () => {
    const workflowWithPrivateDescription = {
      id: 'wf-1',
      name: 'Private Flow',
      description: 'PRIVATE WORKFLOW DESCRIPTION',
      isDeployed: false,
      folderPath: null,
    }
    const data = baseData({ workflows: [workflowWithPrivateDescription] })

    expect(buildWorkspaceMd(data)).not.toContain('PRIVATE WORKFLOW DESCRIPTION')
    expect(JSON.stringify(buildVfsSnapshot(data))).not.toContain('PRIVATE WORKFLOW DESCRIPTION')
    expect(buildVfsSnapshot(data).workflows?.[0]).not.toHaveProperty('description')
  })

  it('advertises the lazy Eval index when a workflow has active suites', () => {
    const md = buildWorkspaceMd(
      baseData({
        workflows: [
          {
            id: 'wf-1',
            name: 'Root Flow',
            isDeployed: false,
            folderPath: null,
            evalSuiteCount: 3,
            evalTestCount: 46,
          },
        ],
      })
    )

    expect(md).toContain('VFS Evals path: `workflows/Root%20Flow/evals.json` (3 suites, 46 tests)')
  })

  it('omits the Eval index marker when a workflow has no active suites', () => {
    const md = buildWorkspaceMd(
      baseData({
        workflows: [{ id: 'wf-1', name: 'Root Flow', isDeployed: false, folderPath: null }],
      })
    )

    expect(md).not.toContain('evals.json')
  })
})

describe('buildWorkspaceMd - connected integrations / credentials', () => {
  it('lists each connected account with its credentialId and never leaks tokens', () => {
    const md = buildWorkspaceMd(
      baseData({
        oauthIntegrations: [
          {
            id: 'cred-abc',
            providerId: 'google-email',
            displayName: 'alice@example.com',
            role: 'admin',
          },
          { id: 'cred-def', providerId: 'slack', displayName: 'Workspace Bot', role: 'member' },
        ],
      })
    )

    // credentialId must be present so the superagent can pass it without reading credentials.json.
    expect(md).toContain('credentialId: `cred-abc`')
    expect(md).toContain('credentialId: `cred-def`')
    expect(md).toContain('google-email')
    expect(md).toContain('slack')

    // No OAuth secrets/tokens may ever appear in the workspace context.
    for (const secret of [
      'accessToken',
      'refreshToken',
      'idToken',
      'clientSecret',
      'access_token',
      'refresh_token',
    ]) {
      expect(md).not.toContain(secret)
    }
  })

  it('renders (none) when no integrations are connected', () => {
    const md = buildWorkspaceMd(baseData({ oauthIntegrations: [] }))
    expect(md).toContain('## Connected Integrations\n(none)')
  })

  it('injects available environment credential names into markdown and the typed snapshot', () => {
    const data = baseData({ envVariables: ['OPENAI_API_KEY', 'STRIPE_SECRET_KEY'] })

    const md = buildWorkspaceMd(data)
    expect(md).toContain('## Environment Variables (2)')
    expect(md).toContain('- OPENAI_API_KEY')
    expect(md).toContain('- STRIPE_SECRET_KEY')
    expect(buildVfsSnapshot(data).envVars).toEqual(['OPENAI_API_KEY', 'STRIPE_SECRET_KEY'])
  })
})

describe('buildWorkspaceMd - determinism (prompt-cache stability)', () => {
  it('is byte-identical regardless of input row order', () => {
    const a = buildWorkspaceMd(
      baseData({
        members: [
          { name: 'Bob', email: 'bob@x.com', permissionType: 'admin' },
          { name: 'Amy', email: 'amy@x.com', permissionType: 'write' },
        ],
        workflows: [
          { id: 'wf-2', name: 'Zeta', isDeployed: false, folderPath: null },
          { id: 'wf-1', name: 'Alpha', isDeployed: true, folderPath: null },
        ],
        tables: [
          { id: 't-2', name: 'Orders', description: null, rowCount: 5 },
          { id: 't-1', name: 'Customers', description: null, rowCount: 9 },
        ],
        knowledgeBases: [
          { id: 'kb-2', name: 'Docs', connectorTypes: ['notion', 'github'] },
          { id: 'kb-1', name: 'Articles', connectorTypes: ['github', 'notion'] },
        ],
        oauthIntegrations: [
          { id: 'c-2', providerId: 'slack', displayName: null, role: null },
          { id: 'c-1', providerId: 'github', displayName: null, role: null },
        ],
        envVariables: ['ZED', 'API_KEY'],
        customTools: [
          { id: 'ct-2', name: 'Beta Tool' },
          { id: 'ct-1', name: 'Alpha Tool' },
        ],
        mcpServers: [
          { id: 'mcp-2', name: 'Zulu', url: null, enabled: false },
          { id: 'mcp-1', name: 'Mike', url: 'https://x', enabled: true },
        ],
        skills: [
          { id: 'sk-2', name: 'Writer', description: 'writes' },
          { id: 'sk-1', name: 'Editor', description: 'edits' },
        ],
        jobs: [
          {
            id: 'j-2',
            title: 'Nightly',
            prompt: 'run nightly',
            cronExpression: '0 0 * * *',
            status: 'active',
            lifecycle: 'persistent',
            sourceTaskName: null,
          },
          {
            id: 'j-1',
            title: 'Hourly',
            prompt: 'run hourly',
            cronExpression: '0 * * * *',
            status: 'active',
            lifecycle: 'persistent',
            sourceTaskName: null,
          },
        ],
      })
    )
    const b = buildWorkspaceMd(
      baseData({
        members: [
          { name: 'Amy', email: 'amy@x.com', permissionType: 'write' },
          { name: 'Bob', email: 'bob@x.com', permissionType: 'admin' },
        ],
        workflows: [
          { id: 'wf-1', name: 'Alpha', isDeployed: true, folderPath: null },
          { id: 'wf-2', name: 'Zeta', isDeployed: false, folderPath: null },
        ],
        tables: [
          { id: 't-1', name: 'Customers', description: null, rowCount: 9 },
          { id: 't-2', name: 'Orders', description: null, rowCount: 5 },
        ],
        knowledgeBases: [
          { id: 'kb-1', name: 'Articles', connectorTypes: ['notion', 'github'] },
          { id: 'kb-2', name: 'Docs', connectorTypes: ['github', 'notion'] },
        ],
        oauthIntegrations: [
          { id: 'c-1', providerId: 'github', displayName: null, role: null },
          { id: 'c-2', providerId: 'slack', displayName: null, role: null },
        ],
        envVariables: ['API_KEY', 'ZED'],
        customTools: [
          { id: 'ct-1', name: 'Alpha Tool' },
          { id: 'ct-2', name: 'Beta Tool' },
        ],
        mcpServers: [
          { id: 'mcp-1', name: 'Mike', url: 'https://x', enabled: true },
          { id: 'mcp-2', name: 'Zulu', url: null, enabled: false },
        ],
        skills: [
          { id: 'sk-1', name: 'Editor', description: 'edits' },
          { id: 'sk-2', name: 'Writer', description: 'writes' },
        ],
        jobs: [
          {
            id: 'j-1',
            title: 'Hourly',
            prompt: 'run hourly',
            cronExpression: '0 * * * *',
            status: 'active',
            lifecycle: 'persistent',
            sourceTaskName: null,
          },
          {
            id: 'j-2',
            title: 'Nightly',
            prompt: 'run nightly',
            cronExpression: '0 0 * * *',
            status: 'active',
            lifecycle: 'persistent',
            sourceTaskName: null,
          },
        ],
      })
    )
    expect(a).toBe(b)
  })

  it('ignores volatile workflow run timestamps', () => {
    const withRun = buildWorkspaceMd(
      baseData({
        workflows: [
          {
            id: 'wf-1',
            name: 'Alpha',
            isDeployed: false,
            folderPath: null,
            lastRunAt: new Date('2026-06-18T12:00:00Z'),
          },
        ],
      })
    )
    const withoutRun = buildWorkspaceMd(
      baseData({
        workflows: [{ id: 'wf-1', name: 'Alpha', isDeployed: false, folderPath: null }],
      })
    )
    expect(withRun).toBe(withoutRun)
    expect(withRun).not.toContain('last run')
  })

  it('ignores volatile table row counts', () => {
    const a = buildWorkspaceMd(
      baseData({ tables: [{ id: 't-1', name: 'Customers', description: null, rowCount: 1 }] })
    )
    const b = buildWorkspaceMd(
      baseData({ tables: [{ id: 't-1', name: 'Customers', description: null, rowCount: 9999 }] })
    )
    expect(a).toBe(b)
    expect(a).not.toContain('rows')
  })
})

describe('custom blocks', () => {
  const customBlocks = [
    { type: 'custom_block_abc', name: 'Invoice Parser', description: 'Parses invoices' },
  ]

  it('renders a Custom Blocks section in the workspace markdown', () => {
    const md = buildWorkspaceMd(baseData({ customBlocks }))
    expect(md).toContain('## Custom Blocks (1)')
    expect(md).toContain('- **Invoice Parser** (custom_block_abc) — Parses invoices')
  })

  it('omits the section when there are no custom blocks', () => {
    expect(buildWorkspaceMd(baseData())).not.toContain('## Custom Blocks')
  })

  it('never leaks custom blocks into the typed snapshot Go diffs (diff-safety)', () => {
    const withBlocks = buildVfsSnapshot(baseData({ customBlocks }))
    const without = buildVfsSnapshot(baseData())
    expect('customBlocks' in withBlocks).toBe(false)
    expect(JSON.stringify(withBlocks)).toBe(JSON.stringify(without))
  })
})
