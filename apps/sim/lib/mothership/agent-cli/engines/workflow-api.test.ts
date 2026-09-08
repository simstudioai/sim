/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'
import { v2ExecuteWorkflowBodySchema } from '@/lib/api/contracts/v2/workflows'
import { workflowApiCommand } from '@/lib/mothership/agent-cli/engines/workflow-api'
import type { AgentCliRuntime } from '@/lib/mothership/agent-cli/types'

vi.mock('@/lib/core/utils/urls', () => ({ getBaseUrl: () => 'https://self-hosted.example' }))

function fixture(
  options: { public?: boolean; deployed?: boolean; changed?: boolean; api?: boolean } = {}
) {
  const deployed = options.deployed !== false
  const requests: string[] = []
  const deployment = {
    id: 'wf-1',
    isDeployed: deployed,
    deployedAt: '2026-09-08T00:00:00Z',
    warnings: [],
    activeDeployment: deployed
      ? { deploymentVersionId: 'version-2', version: 2, deployedAt: '2026-09-08T00:00:00Z' }
      : null,
    latestDeploymentAttempt: null,
    needsRedeployment: true,
    isPublicApi: options.public === true,
    webhooks: [],
  }
  const version = {
    id: 'version-2',
    version: 2,
    name: null,
    description: null,
    isActive: !options.changed,
    createdAt: '2026-09-08T00:00:00Z',
    state: {
      blocks: {
        start: {
          id: 'start',
          type: options.api === false ? 'schedule' : 'start_trigger',
          name: 'Start',
          enabled: true,
          subBlocks: {
            inputFormat: {
              value: [
                {
                  name: 'query',
                  type: 'string',
                  value: "today's news",
                  description: 'Search query',
                },
                { name: 'limit', type: 'number', value: '5' },
              ],
            },
          },
        },
      },
    },
  }
  const runtime: AgentCliRuntime = {
    workspaceId: 'ws-1',
    userId: 'user-1',
    client: {
      request: async <T>(path: string): Promise<T> => {
        requests.push(path)
        if (path === '/api/v2/workflows/wf-1/deployment') return { data: deployment } as T
        if (path === '/api/v2/workflows/wf-1/versions/2') return { data: version } as T
        throw new Error(`Unexpected request: ${path}`)
      },
    },
  }
  return { runtime, requests }
}

describe('Mothership workflow API details', () => {
  it('reads the pinned live schema, not the changed draft, and describes the configured external API', async () => {
    const { runtime, requests } = fixture()
    const result = await workflowApiCommand.execute(['wf-1'], runtime, {})
    expect(result.exitCode).toBe(0)
    const api = JSON.parse(result.stdout)
    expect(requests).toEqual([
      '/api/v2/workflows/wf-1/deployment',
      '/api/v2/workflows/wf-1/versions/2',
    ])
    expect(api).toMatchObject({
      activeVersion: 2,
      needsRedeployment: true,
      method: 'POST',
      endpoint: 'https://self-hosted.example/api/v2/workflows/wf-1/execute',
    })
    expect(api.input.fields).toEqual([
      { name: 'query', type: 'string', default: "today's news", description: 'Search query' },
      { name: 'limit', type: 'number', default: '5' },
    ])
    expect(api.responses.errors).toContain('HTTP 200 can contain data.status=failed')
    expect(api.examples.poll).toContain('/runs/<runId>?includeOutput=true')
    expect(result.stdout.length).toBeLessThan(7000)
    // The example must survive shell quoting, including apostrophes in saved inputs,
    // and parse as the actual public execute contract rather than a native tool body.
    for (const [mode, command] of Object.entries<string>(api.examples)) {
      if (mode === 'poll') continue
      const quoted = command.split(' --data ')[1]
      expect(quoted.startsWith("'") && quoted.endsWith("'")).toBe(true)
      const body = JSON.parse(quoted.slice(1, -1).replaceAll("'\\''", "'"))
      expect(v2ExecuteWorkflowBodySchema.safeParse(body).success).toBe(true)
      expect(body.input).toEqual({ query: "today's news", limit: 5 })
      expect(body.async === true).toBe(mode === 'async')
      expect(body.stream === true).toBe(mode === 'stream')
    }
  })

  it('keeps API-key auth on queued execution and polling even for a public workflow', async () => {
    const { runtime } = fixture({ public: true })
    const api = JSON.parse((await workflowApiCommand.execute(['wf-1'], runtime, {})).stdout)
    expect(api.authentication.type).toBe('public')
    expect(api.examples.sync).not.toContain('X-API-Key')
    expect(api.examples.stream).not.toContain('X-API-Key')
    expect(api.examples.async).toContain('X-API-Key')
    expect(api.examples.poll).toContain('X-API-Key')
  })

  it('does not advertise a live endpoint when undeployed or lacking an API entry block', async () => {
    const { runtime, requests } = fixture({ deployed: false })
    const undeployed = JSON.parse((await workflowApiCommand.execute(['wf-1'], runtime, {})).stdout)
    expect(undeployed.isDeployed).toBe(false)
    expect(undeployed.endpoint).toBeUndefined()
    expect(requests).toHaveLength(1)
    const noApi = JSON.parse(
      (await workflowApiCommand.execute(['wf-1'], fixture({ api: false }).runtime, {})).stdout
    )
    expect(noApi.apiRunnable).toBe(false)
    expect(noApi.endpoint).toBeUndefined()
  })

  it('refuses mismatched active-version observations and propagates authorization failures', async () => {
    const changed = await workflowApiCommand.execute(
      ['wf-1'],
      fixture({ changed: true }).runtime,
      {}
    )
    expect(changed.exitCode).toBe(1)
    expect(changed.stderr).toContain('active deployment changed')
    const { runtime } = fixture()
    runtime.client.request = vi.fn().mockRejectedValue(new Error('Forbidden'))
    await expect(workflowApiCommand.execute(['wf-1'], runtime, {})).rejects.toThrow('Forbidden')
    expect(runtime.client.request).toHaveBeenCalledTimes(1)
  })
})
