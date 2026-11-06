import { isBrowserToolName } from '@sim/browser-protocol'

/**
 * What a "don't ask again" answer is remembered under. Browser tools share one
 * entry, so allowing the browser to act covers every action instead of asking
 * again for each kind of click. The shared entry is not a tool id, so it can
 * never collide with one.
 */
export function toolApprovalKey(toolName: string): string {
  return isBrowserToolName(toolName) ? 'browser_*' : toolName
}
