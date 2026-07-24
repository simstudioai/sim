/**
 * Maps the chat's open resources to request attachments.
 *
 * This is deliberately the ONLY place shared chat code reads the
 * browser-session store: the live browser panel's page state is client-held
 * (the desktop app's embedded browser), so its attachment is enriched here
 * with the current URL and title for the server to inject as
 * `@active_tab`/`@open_tab` context. A browser panel with no page loaded has
 * nothing to say and is dropped.
 */
import type { MothershipResource } from '@/lib/copilot/resources/types'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

export interface ResourceAttachment {
  type: MothershipResource['type']
  id: string
  title: string
  active: boolean
  /** Live page URL, only on `browser` attachments. */
  url?: string
}

export function buildResourceAttachments(
  resources: readonly MothershipResource[],
  activeResourceId: string | null
): ResourceAttachment[] | undefined {
  const { pageState, tabs, tabsSupported } = useBrowserSessionStore.getState()
  const attachments = resources.flatMap<ResourceAttachment>((resource) => {
    if (resource.type !== 'browser') {
      // A resource persisted without an id (e.g. an unresolvable chip) can
      // never be attached — sending it fails the chat request's validation.
      if (!resource.id) return []
      return [
        {
          type: resource.type,
          id: resource.id,
          title: resource.title,
          active: resource.id === activeResourceId,
        },
      ]
    }

    if (tabsSupported) {
      return tabs
        .filter((tab) => Boolean(tab.url))
        .map((tab) => ({
          type: resource.type,
          id: `${resource.id}:${tab.tabId}`,
          title: tab.title.trim() || resource.title,
          active: resource.id === activeResourceId && tab.active,
          url: tab.url,
        }))
    }

    if (!pageState?.url) return []
    return [
      {
        type: resource.type,
        id: resource.id,
        title: pageState.title.trim() || resource.title,
        active: resource.id === activeResourceId,
        url: pageState.url,
      },
    ]
  })

  if (attachments.length === 0) {
    return undefined
  }
  return attachments
}
