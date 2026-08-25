/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { mapResourceToContext } from '@/app/workspace/[workspaceId]/home/components/user-input/components/constants'
import type { MothershipResource } from '@/app/workspace/[workspaceId]/home/types'

function resource(partial: Partial<MothershipResource> & Pick<MothershipResource, 'type'>) {
  return { id: 'id-1', title: 'Something', ...partial } as MothershipResource
}

describe('mapResourceToContext', () => {
  it('turns the singleton panels into whole-resource pointers', () => {
    expect(
      mapResourceToContext(resource({ type: 'browser', id: 'browser-session', title: 'Browser' }))
    ).toEqual({ kind: 'browser_tab', tabId: 'browser-session', label: 'Browser' })
    expect(
      mapResourceToContext(
        resource({ type: 'terminal', id: 'terminal-session', title: 'Terminal' })
      )
    ).toEqual({ kind: 'terminal_tab', terminalId: 'terminal-session', label: 'Terminal' })
  })

  it('turns a dragged browser tab into a pointer at that tab', () => {
    // The id is the TAB's, not the panel's: the panel is a singleton and
    // pointing at it would not say which page the user meant.
    const context = mapResourceToContext(
      resource({ type: 'browser', id: 'tab-7', title: 'Pull requests' })
    )

    expect(context).toEqual({ kind: 'browser_tab', tabId: 'tab-7', label: 'Pull requests' })
  })

  it('turns a dragged terminal tab into a pointer at that shell', () => {
    const context = mapResourceToContext(resource({ type: 'terminal', id: '3', title: 'sim' }))

    expect(context).toEqual({ kind: 'terminal_tab', terminalId: '3', label: 'sim' })
  })

  it('still maps the ordinary workspace resources', () => {
    expect(
      mapResourceToContext(resource({ type: 'workflow', id: 'wf-1', title: 'Deploy' }))
    ).toEqual({ kind: 'workflow', workflowId: 'wf-1', label: 'Deploy' })
    expect(mapResourceToContext(resource({ type: 'table', id: 't-1', title: 'Leads' }))).toEqual({
      kind: 'table',
      tableId: 't-1',
      label: 'Leads',
    })
  })

  it.each(['skill', 'custom_tool', 'mcp_server'] as const)(
    'does not manufacture prompt context for panel-only %s resources',
    (type) => {
      expect(mapResourceToContext(resource({ type }))).toBeNull()
    }
  )
})
