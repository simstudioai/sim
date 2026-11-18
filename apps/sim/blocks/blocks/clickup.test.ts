import { triggersMock } from '@sim/testing/mocks/triggers.mock'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/triggers', () => triggersMock)

import { ClickUpBlock } from '@/blocks/blocks/clickup'
import type { BlockToolParamsContext } from '@/blocks/types'

const mapParams = (
  inputs: Record<string, unknown>,
  context?: BlockToolParamsContext
): Record<string, unknown> => ClickUpBlock.tools.config?.params?.(inputs, context) ?? {}

/** On an agent call the stored operation reaches the mapper only on `context`, never in the args. */
describe('ClickUp agent tool calls', () => {
  it('maps the workspace picked on the tool to workspaceId', () => {
    expect(mapParams({ teamId: 'team-1' }, { operation: 'search_tasks' }).workspaceId).toBe(
      'team-1'
    )
  })

  it('keeps the model workspaceId when no workspace is picked', () => {
    expect(mapParams({ workspaceId: 'team-2' }, { operation: 'get_spaces' }).workspaceId).toBe(
      'team-2'
    )
  })

  it('maps the picked workspace on the canvas exactly as before', () => {
    expect(mapParams({ operation: 'search_tasks', teamId: 'team-1' }).workspaceId).toBe('team-1')
  })
})
