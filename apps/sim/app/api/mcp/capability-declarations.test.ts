/**
 * @vitest-environment node
 *
 * Every raw MCP management route declares the permission-group capability its
 * `/api/v2` twin declares in `mcpServerOperations`.
 *
 * The type system already forces a declaration to exist — `withMcpAuth` takes
 * the capability as a required argument — but it cannot say whether the value is
 * the right one, and a new sibling reaching for `'none'` because it compiles is
 * the exact shape of the bug this closes: twelve routes sat beside a gated
 * thirteenth for a release, including the one whose `isPublic` flip strips
 * authentication from everything the server publishes.
 */
import { describe, expect, it, vi } from 'vitest'

const { recorded } = vi.hoisted(() => ({
  recorded: [] as { file: string; level: string; capability: string }[],
}))

vi.mock('@/lib/mcp/middleware', () => ({
  readMcpJsonBodyWithLimit: (request: Request) => request.json(),
  mcpBodyReadErrorResponse: () => null,
  withMcpAuth: (level: string, capability: string) => {
    /**
     * The declaring module, read off the call site. `withMcpAuth` is invoked at
     * module scope, so the frame below this one is the route file — which is
     * what lets one recording mock speak about thirteen modules at once.
     */
    const frame = new Error('capture').stack?.split('\n')[2] ?? ''
    const file = frame.match(/app\/api\/mcp\/[^):\s]*route\.ts/)?.[0] ?? frame
    recorded.push({ file, level, capability })
    return (handler: unknown) => handler
  },
}))

import '@/app/api/mcp/workflow-servers/route'
import '@/app/api/mcp/workflow-servers/[id]/route'
import '@/app/api/mcp/workflow-servers/[id]/tools/route'
import '@/app/api/mcp/workflow-servers/[id]/tools/[toolId]/route'
import '@/app/api/mcp/servers/route'
import '@/app/api/mcp/servers/[id]/route'
import '@/app/api/mcp/servers/[id]/refresh/route'
import '@/app/api/mcp/servers/test-connection/route'
import '@/app/api/mcp/tools/discover/route'
import '@/app/api/mcp/tools/stored/route'
import '@/app/api/mcp/oauth/start/route'

describe('MCP management route capability declarations', () => {
  it('gates every handler on a capability, never on nothing', () => {
    expect(recorded.length).toBeGreaterThanOrEqual(20)
    expect(recorded.filter((entry) => entry.capability === 'none')).toEqual([])
  })

  /**
   * `mcp_servers.workflow_deployments.*` is publishing a workflow *as* an MCP
   * server, which is what `hideDeployMcp` names — reads included, so a group
   * withholding the surface does not still answer with what is published on it.
   */
  it('declares deploy.mcp on every workflow-server route, reads included', () => {
    const deployRoutes = recorded.filter((entry) => entry.file.includes('workflow-servers'))

    expect(deployRoutes.length).toBe(10)
    expect(deployRoutes.every((entry) => entry.capability === 'deploy.mcp')).toBe(true)
  })

  /**
   * `mcp_servers.*` is the workspace's registry of external MCP servers, which
   * every one of its operations declares `mcp_tools.use` for.
   */
  it('declares mcp_tools.use on every external-server registry route', () => {
    const registryRoutes = recorded.filter((entry) => !entry.file.includes('workflow-servers'))

    expect(registryRoutes.length).toBeGreaterThanOrEqual(10)
    expect(registryRoutes.every((entry) => entry.capability === 'mcp_tools.use')).toBe(true)
  })
})
