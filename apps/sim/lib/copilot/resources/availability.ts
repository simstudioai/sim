import { isBrowserAgentAvailable } from '@/lib/browser-agent/transport'
import { isDesktopOnlyResource, type MothershipResource } from '@/lib/copilot/resources/types'
import { isTerminalAvailable } from '@/lib/terminal/transport'

/**
 * Whether this client can show the resource's panel at all.
 *
 * Browser and terminal tabs are windows onto something the desktop app owns —
 * an embedded browser view, a pty — so the web app has nothing to show for
 * them. This only decides whether to put a resource on screen.
 */
export function canDisplayResource(resource: MothershipResource): boolean {
  if (!isDesktopOnlyResource(resource)) return true
  if (resource.type === 'browser') return isBrowserAgentAvailable()
  if (resource.type === 'terminal') return isTerminalAvailable()
  return false
}
