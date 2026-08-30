/**
 * @vitest-environment node
 */

import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The handler map is a wiring table from tool id to implementation. Only its
 * shape is asserted here, so every implementation module it imports is stubbed
 * except `workflow/mutations`, which holds the cancellation handler under test
 * and loads for real so a renamed or removed export fails at link time.
 * Loading the rest reaches the block registry, the executor, and most of
 * `lib/`; every stubbed export resolves to a mock function, which is all the
 * table needs to bind.
 */
const { stubHandlerModule } = vi.hoisted(() => ({
  stubHandlerModule: () =>
    new Proxy(
      {},
      {
        get: (_target, name) => (typeof name === 'string' && name !== 'then' ? vi.fn() : undefined),
        has: (_target, name) => typeof name === 'string' && name !== 'then',
      }
    ),
}))

vi.mock('@/lib/copilot/tools/handlers/deployment/custom-block', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/deployment/deploy', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/deployment/manage', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/function-execute', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/integration-tools', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/management/connect-slack-bot', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/management/manage-credential', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/management/manage-custom-tool', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/management/manage-mcp-tool', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/management/manage-sandbox', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/management/manage-skill', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/materialize-file', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/oauth', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/resources', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/restore-resource', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/run-code', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/vfs', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/vfs-mutate', stubHandlerModule)
vi.mock('@/lib/copilot/tools/handlers/workflow/queries', stubHandlerModule)

/** Server-router tools are appended to the map from their own registry, which this test does not cover. */
vi.mock('@/lib/copilot/tools/server/router', () => ({ getRegisteredServerToolNames: () => [] }))

import { hasHandler } from '@/lib/copilot/tool-executor/executor'
import { buildHandlerMap } from '@/lib/copilot/tool-executor/handler-map'
import { ensureHandlersRegistered } from '@/lib/copilot/tool-executor/register-handlers'
import {
  getToolEntry,
  isSimExecuted,
  toolRequiresApproval,
  toolRequiresApprovalLane,
} from '@/lib/copilot/tool-executor/router'
import { executeCancelWorkflowRun } from '@/lib/copilot/tools/handlers/workflow/mutations'

describe('workflow-run cancellation tool routing', () => {
  it('routes cancellation through Sim with write permission and explicit approval', () => {
    expect(getToolEntry('cancel_workflow_run')).toMatchObject({
      requiredPermission: 'write',
      route: 'sim',
    })
    expect(isSimExecuted('cancel_workflow_run')).toBe(true)
    expect(toolRequiresApproval('cancel_workflow_run')).toBe(true)
  })

  it('registers the Sim cancellation handler', async () => {
    await ensureHandlersRegistered()

    expect(hasHandler('cancel_workflow_run')).toBe(true)
    expect(executeCancelWorkflowRun).toBeTypeOf('function')
    expect(buildHandlerMap().cancel_workflow_run).toBe(executeCancelWorkflowRun)
  })
})

describe('toolRequiresApprovalLane', () => {
  afterEach(resetEnvFlagsMock)

  /**
   * Asked by lanes that cannot hold a prompt, so it answers from the catalog and the
   * feature flag alone: there is no streaming context to consult, and the stored
   * auto-allow list is deliberately not read (an auto-allowed tool is admitted on the
   * checkpoint lane without prompting anyone).
   */
  it('is false while copilot tool permissions are off, whatever the catalog says', () => {
    expect(toolRequiresApproval('run_function')).toBe(true)
    expect(toolRequiresApprovalLane('run_function')).toBe(false)
  })

  it('is true for a catalog-gated tool once the feature is on', () => {
    setEnvFlags({ isCopilotToolPermissionsEnabled: true })
    expect(toolRequiresApprovalLane('run_function')).toBe(true)
  })

  it('is false for a tool the catalog does not gate, feature on', () => {
    setEnvFlags({ isCopilotToolPermissionsEnabled: true })
    expect(toolRequiresApproval('read')).toBe(false)
    expect(toolRequiresApprovalLane('read')).toBe(false)
  })

  it('is false for a tool that is not in the catalog at all', () => {
    setEnvFlags({ isCopilotToolPermissionsEnabled: true })
    expect(toolRequiresApprovalLane('not_a_real_tool')).toBe(false)
  })
})
