/**
 * @vitest-environment node
 */
import { dbChainMockFns, queueTableRows, resetDbChainMock, schemaMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { scanSecretReferences } from '@/lib/secrets/references/scan'

/** A stored block row as the scan reads it, with one short-input sub-block. */
function blockRow(overrides: {
  blockId: string
  blockName: string
  workflowId: string
  workflowName: string
  subBlocks: Record<string, unknown>
  blockType?: string
}) {
  return {
    blockType: 'agent',
    data: {},
    ...overrides,
  }
}

function shortInput(key: string, value: unknown) {
  return { [key]: { id: key, type: 'short-input', value } }
}

describe('scanSecretReferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetDbChainMock()
  })

  it('groups referencing blocks under their workflow', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Fetch orders',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('apiKey', '{{API_KEY}}'),
      }),
      blockRow({
        blockId: 'block-2',
        blockName: 'Post results',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('headers', 'Bearer {{API_KEY}}'),
      }),
      blockRow({
        blockId: 'block-3',
        blockName: 'Notify',
        workflowId: 'workflow-2',
        workflowName: 'Alerting',
        subBlocks: shortInput('token', '{{API_KEY}}'),
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows).toEqual([
      {
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        blocks: [
          { blockId: 'block-1', blockName: 'Fetch orders', blockType: 'agent', field: 'apiKey' },
          { blockId: 'block-2', blockName: 'Post results', blockType: 'agent', field: 'headers' },
        ],
      },
      {
        workflowId: 'workflow-2',
        workflowName: 'Alerting',
        blocks: [{ blockId: 'block-3', blockName: 'Notify', blockType: 'agent', field: 'token' }],
      },
    ])
    expect(scan.truncated).toBe(false)
  })

  /**
   * The SQL prefilter matches the reference syntax, so these never reach the scanner in
   * production — but the scanner stays the authority, and these pin that it agrees. Reporting
   * them would send someone rotating one key to edit blocks that never touch it.
   */
  it('drops a block whose reference only shares a prefix with the name', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Staging call',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('apiKey', '{{API_KEY_TEST}}'),
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows).toEqual([])
  })

  /** A prefilter hit with no `{{ }}` around the name is prose, not a reference. */
  it('drops a block that only names the secret in free text', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Docs',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('systemPrompt', 'Ask the admin for the API_KEY value.'),
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows).toEqual([])
  })

  /**
   * The fork remapper collapses a block's references to one per `(kind, sourceId)`, so a block
   * naming the secret twice yields one entry, not two. Pinned here because the panel renders
   * `field` as the row's whole description — if this ever became a list, the row would need to
   * say so rather than silently naming one of several.
   */
  it('reports one entry for a block that references the secret in two fields', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Fetch orders',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: {
          ...shortInput('apiKey', '{{API_KEY}}'),
          ...shortInput('headers', 'Bearer {{API_KEY}}'),
          ...shortInput('url', 'https://example.com'),
        },
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    const blocks = scan.workflows[0]?.blocks ?? []
    expect(blocks).toHaveLength(1)
    expect(['apiKey', 'headers']).toContain(blocks[0]?.field)
  })

  /**
   * `{subBlockId}-tool-{index}-{paramId}` keys are a client-only projection of the canonical
   * `tool-input` value that older rows persisted anyway. Reporting one puts an internal key
   * where the reader expects a field name, so the canonical sub-block has to win.
   */
  it('reports the canonical field rather than a persisted tool mirror', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Agent 1',
        workflowId: 'workflow-1',
        workflowName: 'Exa Tool Demo',
        subBlocks: {
          ...shortInput('tools', [{ params: { code: 'const k = "{{API_KEY}}"' } }]),
          ...shortInput('tools-tool-0-code', 'const k = "{{API_KEY}}"'),
        },
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows[0]?.blocks[0]?.field).toBe('tools')
  })

  it('finds a reference nested inside a sub-block value', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Call API',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('params', [{ name: 'auth', value: '{{API_KEY}}' }]),
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows[0]?.blocks[0]?.field).toBe('params')
  })

  /**
   * `ENV_REF_PATTERN`'s `\s` spans more than ASCII, so a value pasted with a non-breaking or
   * ideographic space inside the braces is a reference the executor resolves. Reporting it as
   * unreferenced is the one failure direction this feature must never take.
   */
  it.each([
    ['ascii space', '{{ API_KEY }}'],
    ['tab', '{{\tAPI_KEY\t}}'],
    ['newline', '{{\nAPI_KEY\n}}'],
    ['non-breaking space', '{{ API_KEY }}'],
    ['narrow non-breaking space', '{{ API_KEY }}'],
    ['ideographic space', '{{　API_KEY　}}'],
  ])('tolerates %s inside the reference braces', async (_label, value) => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Call API',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('apiKey', value),
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows[0]?.blocks[0]?.field).toBe('apiKey')
  })

  /**
   * One unreadable block must not blank the whole tab — the other blocks are still the honest
   * answer, and a reference reported without the field that carries it is worse than omitted.
   */
  it('skips a block whose sub-blocks cannot be scanned', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Corrupt',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: null as unknown as Record<string, unknown>,
      }),
      blockRow({
        blockId: 'block-2',
        blockName: 'Fetch orders',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('apiKey', '{{API_KEY}}'),
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows[0]?.blocks.map((block) => block.blockId)).toEqual(['block-2'])
  })

  it('reports custom tools and MCP servers that carry the secret', async () => {
    queueTableRows(schemaMock.customTools, [
      { id: 'tool-1', title: 'Order lookup', code: 'fetch(url, { key: "{{API_KEY}}" })' },
      { id: 'tool-2', title: 'Unrelated', code: 'const label = "API_KEY"' },
    ])
    queueTableRows(schemaMock.mcpServers, [
      {
        id: 'server-1',
        name: 'Billing',
        url: 'https://example.com?token={{API_KEY}}',
        headers: { Authorization: 'Bearer {{API_KEY}}', 'X-Trace': 'on' },
      },
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.resources).toEqual([
      { id: 'tool-1', kind: 'custom-tool', name: 'Order lookup', field: 'code' },
      { id: 'server-1', kind: 'mcp-server', name: 'Billing', field: 'url' },
      { id: 'server-1', kind: 'mcp-server', name: 'Billing', field: 'header: Authorization' },
    ])
  })

  it('flags a scan that hit the block cap', async () => {
    queueTableRows(
      schemaMock.workflowBlocks,
      Array.from({ length: 2001 }, (_, index) =>
        blockRow({
          blockId: `block-${index}`,
          blockName: `Block ${index}`,
          workflowId: 'workflow-1',
          workflowName: 'Nightly sync',
          subBlocks: shortInput('apiKey', '{{API_KEY}}'),
        })
      )
    )

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.truncated).toBe(true)
    expect(scan.workflows[0]?.blocks).toHaveLength(2000)
  })

  /**
   * Landing exactly on a bound is a complete scan, not a truncated one. Claiming truncation
   * there tells the reader references may be missing when every one was returned — the same
   * "absence of evidence" note, on a scan that has none.
   */
  it('does not claim truncation for a scan that ends exactly on the result limit', async () => {
    queueTableRows(
      schemaMock.workflowBlocks,
      Array.from({ length: 2000 }, (_, index) =>
        blockRow({
          blockId: `block-${index}`,
          blockName: `Block ${index}`,
          workflowId: 'workflow-1',
          workflowName: 'Nightly sync',
          subBlocks: shortInput('apiKey', '{{API_KEY}}'),
        })
      )
    )

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows[0]?.blocks).toHaveLength(2000)
    expect(scan.truncated).toBe(false)
  })

  /**
   * The cap counts what is reported, not what is read. The prefilter judges syntax only, so a
   * block naming the secret in prose is a genuine candidate that the scanner then rejects — and
   * when the cap counted candidates, enough of those sorted earlier pushed real references out of
   * the answer entirely.
   */
  it('does not let filtered candidates displace real references', async () => {
    const noise = Array.from({ length: 2500 }, (_, index) =>
      blockRow({
        blockId: `noise-${index}`,
        blockName: `Noise ${index}`,
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('systemPrompt', 'the API_KEY is configured elsewhere'),
      })
    )
    const real = blockRow({
      blockId: 'block-real',
      blockName: 'Fetch orders',
      workflowId: 'workflow-1',
      workflowName: 'Nightly sync',
      subBlocks: shortInput('apiKey', '{{API_KEY}}'),
    })
    queueTableRows(schemaMock.workflowBlocks, [...noise, real])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.workflows[0]?.blocks.map((block) => block.blockId)).toEqual(['block-real'])
  })

  it('returns nothing for a secret referenced nowhere', async () => {
    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan).toEqual({ workflows: [], resources: [], truncated: false })
  })

  /**
   * A name outside the env-key charset can never sit inside `{{ }}`, so the scan short-circuits
   * before touching the database — which is also what makes it safe to inline the name into the
   * SQL regex without escaping.
   */
  it('scans nothing for a name that cannot be an env reference', async () => {
    queueTableRows(schemaMock.workflowBlocks, [
      blockRow({
        blockId: 'block-1',
        blockName: 'Fetch orders',
        workflowId: 'workflow-1',
        workflowName: 'Nightly sync',
        subBlocks: shortInput('apiKey', '{{API_KEY}}'),
      }),
    ])

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API.*KEY' })

    expect(scan).toEqual({ workflows: [], resources: [], truncated: false })
    expect(dbChainMockFns.select).not.toHaveBeenCalled()
  })

  /**
   * The row caps bound what is READ; one MCP server expands to an entry per matching header, so
   * the emitted total is what has to stay inside the contract's array bound. Without this the
   * route rejects its own response and a successful scan surfaces as a 500.
   */
  it('caps emitted resources so the response bound holds', async () => {
    const headers: Record<string, string> = {}
    for (let index = 0; index < 300; index++) headers[`X-Key-${index}`] = 'Bearer {{API_KEY}}'
    queueTableRows(
      schemaMock.mcpServers,
      Array.from({ length: 3 }, (_, index) => ({
        id: `server-${index}`,
        name: `Server ${index}`,
        url: 'https://example.com',
        headers,
      }))
    )

    const scan = await scanSecretReferences({ workspaceId: 'workspace-1', name: 'API_KEY' })

    expect(scan.resources).toHaveLength(400)
    expect(scan.truncated).toBe(true)
  })
})
