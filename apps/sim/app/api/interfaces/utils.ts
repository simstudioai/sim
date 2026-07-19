import { createLogger } from '@sim/logger'
import { permissionSatisfies } from '@sim/platform-authz/workspace'
import { NextResponse } from 'next/server'
import {
  getInterfaceById,
  InterfaceConflictError,
  type InterfaceDefinition,
  InterfaceLayoutError,
  InterfaceStaleWriteError,
  InvalidModuleReferenceError,
} from '@/lib/interfaces'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * Shared authorization and error-mapping helpers for `/api/interfaces/**`.
 *
 * `getInterfaceById` is not workspace-scoped, so authorizing against the
 * client-supplied `workspaceId` alone would let a member of workspace A act on
 * an interface owned by workspace B. Every `[interfaceId]` handler therefore
 * loads the record first and authorizes against the record's own workspace —
 * {@link resolveInterfaceAccess} is that guard, and it is mandatory.
 */

const logger = createLogger('InterfacesAPIUtils')

export interface ResolveInterfaceAccessArgs {
  interfaceId: string
  /** Client-supplied workspace; must match the record's own workspace or the request 404s. */
  workspaceId: string
  userId: string
  /** `read` for GET; `write` for every mutation, including form submits (they bill the workspace). */
  level: 'read' | 'write'
  /** Only the restore route may resolve archived rows. */
  includeArchived?: boolean
  requestId: string
}

export type InterfaceAccessResult =
  | { ok: true; definition: InterfaceDefinition }
  | { ok: false; response: NextResponse }

/**
 * Loads an interface and authorizes the caller against the record's workspace.
 *
 * Returns the 404 response when the record is missing or belongs to another
 * workspace, and the 403 response when the caller's workspace permission does
 * not satisfy `level`.
 */
export async function resolveInterfaceAccess(
  args: ResolveInterfaceAccessArgs
): Promise<InterfaceAccessResult> {
  const { interfaceId, workspaceId, userId, level, includeArchived = false, requestId } = args

  const definition = await getInterfaceById(interfaceId, { includeArchived })
  if (!definition || definition.workspaceId !== workspaceId) {
    logger.warn(`[${requestId}] Interface not found: ${interfaceId}`)
    return {
      ok: false,
      response: NextResponse.json({ error: 'Interface not found' }, { status: 404 }),
    }
  }

  const permission = await getUserEntityPermissions(userId, 'workspace', definition.workspaceId)
  if (!permissionSatisfies(permission, level)) {
    logger.warn(`[${requestId}] Access denied to interface ${interfaceId} for user ${userId}`)
    return {
      ok: false,
      response: NextResponse.json({ error: 'Access denied' }, { status: 403 }),
    }
  }

  return { ok: true, definition }
}

/**
 * Maps a thrown interface-domain error to its HTTP response, or `null` when the
 * error is unrecognized and the caller should log it and return its own 500.
 */
export function interfaceDomainErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof InterfaceLayoutError) {
    return NextResponse.json({ error: error.message, details: error.errors }, { status: 400 })
  }
  if (error instanceof InvalidModuleReferenceError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  if (error instanceof InterfaceConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  /**
   * Shares the 409 with a name conflict, so the discriminating `code` is on the
   * body — the editor auto-reloads on a stale write but must leave a name
   * conflict for the user to resolve.
   */
  if (error instanceof InterfaceStaleWriteError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
  }
  return null
}
