/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { hasHandler } from '@/lib/copilot/tool-executor/executor'
import { ensureHandlersRegistered } from '@/lib/copilot/tool-executor/register-handlers'
import {
  getToolEntry,
  isSimExecuted,
  toolRequiresApproval,
} from '@/lib/copilot/tool-executor/router'

describe('workflow-run cancellation tool routing', () => {
  it('routes cancellation through Sim with write permission and explicit approval', () => {
    expect(getToolEntry('cancel_workflow_run')).toMatchObject({
      requiredPermission: 'write',
      route: 'sim',
    })
    expect(isSimExecuted('cancel_workflow_run')).toBe(true)
    expect(toolRequiresApproval('cancel_workflow_run')).toBe(true)
  })

  // Registration loads the whole handler map on first use, which is most of
  // `lib/` — well past the default 10s under a fully parallel run.
  it('registers the Sim cancellation handler', async () => {
    await ensureHandlersRegistered()

    expect(hasHandler('cancel_workflow_run')).toBe(true)
  }, 90_000)
})
