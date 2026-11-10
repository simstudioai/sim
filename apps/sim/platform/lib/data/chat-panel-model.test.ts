/**
 * @vitest-environment node
 *
 * Failure modes: a chat panel tab's Open link landing on the wrong surface (a workflow folder in
 * Files), or looping back to the chat it sits in (a test or a generic card linked to Home with
 * `?resource=`), or linking into a Tests tab the viewer cannot see; and the + picker offering a
 * kind whose tab has no view, so the pick opens an empty card.
 */
import { describe, expect, it } from 'vitest'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import {
  isPanelFamily,
  type PanelTabsShown,
  pickedResource,
  resourceHref,
} from '@/platform/lib/data/chat-panel-model'

const scope = { routePrefix: '/o/org-1' }
const allShown: PanelTabsShown = { dashboards: true, tests: true }

function href(resource: Omit<MothershipResource, 'title'>, shown = allShown) {
  return resourceHref(scope, { title: 'Resource', ...resource }, shown)
}

describe('resourceHref', () => {
  it('opens a workflow folder in the workflows list, filtered to it', () => {
    expect(href({ type: 'folder', id: 'folder-1', workspaceId: 'ws-1' })).toBe(
      '/workspace/ws-1/workflows?folderId=folder-1'
    )
  })

  it('still opens a file folder in Files', () => {
    expect(href({ type: 'filefolder', id: 'files-1', workspaceId: 'ws-1' })).toBe(
      '/workspace/ws-1/files?folderId=files-1'
    )
  })

  it('opens a test on its Tests page while the Tests tab is shown', () => {
    expect(href({ type: 'test', id: 'checkout flow', workspaceId: 'ws-1' })).toBe(
      '/workspace/ws-1/tests/checkout%20flow'
    )
  })

  it('gives a test no link while the Tests tab is hidden', () => {
    expect(
      href({ type: 'test', id: 'checkout', workspaceId: 'ws-1' }, { ...allShown, tests: false })
    ).toBeUndefined()
  })

  it('gives a generic card no link back into the chat', () => {
    expect(href({ type: 'generic', id: 'note', workspaceId: 'ws-1' })).toBeUndefined()
  })
})

describe('panel picker', () => {
  it('offers no file folders, which have no panel view', () => {
    expect(isPanelFamily('file_folders')).toBe(false)
    expect(isPanelFamily('files')).toBe(true)
  })

  it('opens no tab for a picked file folder', () => {
    expect(
      pickedResource(
        { kind: 'filefolder', fileFolderId: 'files-1', label: 'Specs', workspaceId: 'ws-1' },
        new Map()
      )
    ).toBeNull()
  })
})
