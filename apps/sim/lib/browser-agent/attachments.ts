/**
 * Maps the chat's open resources to request attachments.
 *
 * This is deliberately the ONLY place shared chat code reads the
 * browser-session store: a browser tab's page state is client-held (the
 * desktop app's embedded browser), so its attachment is enriched here with
 * the current URL and title for the server to inject as
 * `@active_tab`/`@open_tab` context. A browser tab with no page loaded has
 * nothing to say and is dropped.
 */
import type { MothershipResourceAttachment } from '@/lib/api/contracts/mothership-resources'
import { browserTabTitle } from '@/lib/browser-agent/tab-label'
import type { MothershipResource } from '@/lib/mothership/resources/types'
import { getBrowserSession } from '@/stores/browser-session/store'

export function buildResourceAttachments(
  resources: readonly MothershipResource[],
  activeResourceId: string | null,
  scopeId: string
): MothershipResourceAttachment[] | undefined {
  const { tabs } = getBrowserSession(scopeId)
  const tabsById = new Map(tabs.map((tab) => [tab.tabId, tab]))
  const attachments = resources.flatMap<MothershipResourceAttachment>((resource) => {
    // The terminal panel is not addressable context: unlike a browser tab it
    // carries no URL to reference, and the shell's state reaches the model
    // through the terminal tools instead.
    if (resource.type === 'terminal') return []

    if (resource.type !== 'browser') {
      return [
        {
          ...resource,
          active: resource.id === activeResourceId,
        },
      ]
    }

    const tab = tabsById.get(resource.id)
    if (!tab?.url) return []
    return [
      {
        type: resource.type,
        id: resource.id,
        title: browserTabTitle(tab),
        active: resource.id === activeResourceId,
        url: tab.url,
      },
    ]
  })

  if (attachments.length === 0) {
    return undefined
  }
  return attachments
}
