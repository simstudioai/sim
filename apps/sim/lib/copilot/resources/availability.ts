import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import { isDesktopOnlyResource, type MothershipResource } from '@/lib/copilot/resources/types'
import { isTerminalAvailable } from '@/lib/terminal/transport'

/**
 * Whether this client can show the resource's panel at all.
 *
 * The browser and terminal panels are stored with the chat like any other
 * resource, so the tab is still there when the chat is reopened. But they are
 * windows onto something the desktop app owns — an embedded browser view, a
 * pty — and opening that same chat in the web app would otherwise restore a
 * tab that leads to an error. Such resources stay in the chat's stored
 * resources either way; this only decides whether to put them on screen.
 */
export function canDisplayResource(resource: MothershipResource): boolean {
  if (!isDesktopOnlyResource(resource)) return true
  if (resource.type === 'browser') return isBrowserAgentAvailable()
  if (resource.type === 'terminal') return isTerminalAvailable()
  return false
}
