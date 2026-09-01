/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { hasHandler } from '@/lib/mothership/tool-executor/executor'
import { ensureHandlersRegistered } from '@/lib/mothership/tool-executor/register-handlers'
import {
  getToolEntry,
  isSimExecuted,
  toolRequiresApproval,
} from '@/lib/mothership/tool-executor/router'

describe('workflow-run cancellation tool routing', () => {
  it('routes cancellation through Sim with write permission and explicit approval', () => {
    expect(getToolEntry('cancel_workflow_run')).toMatchObject({
      requiredPermission: 'write',
      route: 'sim',
    })
    expect(isSimExecuted('cancel_workflow_run')).toBe(true)
    expect(toolRequiresApproval('cancel_workflow_run')).toBe(true)
  })

  it('registers the Sim cancellation handler', () => {
    ensureHandlersRegistered()

    expect(hasHandler('cancel_workflow_run')).toBe(true)
  })
})
