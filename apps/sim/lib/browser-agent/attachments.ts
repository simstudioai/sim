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
  const browserPageState = useBrowserSessionStore.getState().pageState
  const attachable = resources.filter((r) => r.type !== 'browser' || Boolean(browserPageState?.url))
  if (attachable.length === 0) {
    return undefined
  }
  return attachable.map((r) => ({
    type: r.type,
    id: r.id,
    title: r.type === 'browser' ? browserPageState?.title?.trim() || r.title : r.title,
    active: r.id === activeResourceId,
    ...(r.type === 'browser' ? { url: browserPageState?.url } : {}),
  }))
}
