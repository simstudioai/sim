/**
 * Interface orchestration — service operations composed with their audit
 * records. The service layer itself never audits (see the note in
 * `service.ts`), so any caller that bypassed this module could mutate an
 * interface without leaving a trail; the API route, the copilot tool, and the
 * resource-restore orchestrator all restore through here.
 */

import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { restoreInterface } from '@/lib/interfaces/service'
import type { InterfaceDefinition } from '@/lib/interfaces/types'

export interface RestoreInterfaceActor {
  id: string
  name?: string
  email?: string
}

export interface PerformRestoreInterfaceOptions {
  /** Originating HTTP request, when there is one — the audit log derives client info from it. */
  request?: Request
  /** Extra audit metadata, e.g. `{ source: 'tool_input' }` on the copilot path. */
  auditMetadata?: Record<string, unknown>
}

/**
 * Restores an archived interface and records the `INTERFACE_RESTORED` audit
 * event. Domain errors (`InterfaceConflictError`, `InterfaceNotFoundError`,
 * `InterfaceNotArchivedError`, `InterfaceWorkspaceArchivedError`) propagate
 * unchanged to the caller's own mapping.
 *
 * The returned record may carry a suffixed name when the original was
 * reclaimed while the interface was archived.
 */
export async function performRestoreInterface(
  interfaceId: string,
  actor: RestoreInterfaceActor,
  options?: PerformRestoreInterfaceOptions
): Promise<InterfaceDefinition> {
  const restored = await restoreInterface(interfaceId)

  recordAudit({
    workspaceId: restored.workspaceId,
    actorId: actor.id,
    actorName: actor.name,
    actorEmail: actor.email,
    action: AuditAction.INTERFACE_RESTORED,
    resourceType: AuditResourceType.INTERFACE,
    resourceId: restored.id,
    resourceName: restored.name,
    description: `Restored interface "${restored.name}"`,
    request: options?.request,
    metadata: options?.auditMetadata,
  })

  return restored
}
