import { isUserCredentialPrincipal, type Principal } from '@sim/auth/principal'
import type { WorkflowWriteSource } from '@/lib/posthog/events'

/**
 * The user a workflow-source write is attributed to in analytics, and the surface it came
 * through: a personal key or OAuth token counts as the user behind it (`cli` when the CLI
 * submitted it), a Copilot delegation as its subject user. Anything else is not attributed.
 */
export function sourceWriteActor(
  principal: Principal,
  client: string | undefined
): { userId: string; source: WorkflowWriteSource } | null {
  if (isUserCredentialPrincipal(principal)) {
    return { userId: principal.userId, source: client === 'cli' ? 'cli' : 'api' }
  }
  if (principal.kind === 'delegated' && principal.serviceId === 'copilot') {
    return { userId: principal.subjectUserId, source: 'copilot' }
  }
  return null
}
