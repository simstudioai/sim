import { getErrorMessage } from '@sim/utils/errors'
import { type NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { enforceWorkspaceRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import type { SandboxLanguage } from '@/lib/execution/remote-sandbox/sandbox-spec'
import {
  buildSpecUpdate,
  MAX_PLAN_REQUIRED,
  SANDBOX_ADMIN_REQUIRED,
  SANDBOX_MUTATION_LIMIT,
  SANDBOXES_UNAVAILABLE,
  SandboxDependencyError,
  type SandboxSpecUpdate,
  WORKSPACE_SANDBOX_NAME_INDEX,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export interface SandboxMutationActor {
  userId: string
  name?: string | null
  email?: string | null
}

/**
 * The 409 both write paths return for a duplicate name. Shared so the pre-check
 * and the unique-index catch cannot describe the same conflict differently.
 */
export function nameConflictResponse(name: string): NextResponse {
  return NextResponse.json(
    { error: `A sandbox named "${name}" already exists in this workspace` },
    { status: 409 }
  )
}

/**
 * Validates a submitted dependency list, returning the 400 the editor knows how
 * to read — `issues` carries a line number per rejected row, which the generic
 * validation error does not.
 */
export function buildSpecOrResponse(
  language: SandboxLanguage,
  dependencies: readonly string[]
): { ok: true; spec: SandboxSpecUpdate } | { ok: false; response: NextResponse } {
  try {
    return { ok: true, spec: buildSpecUpdate(language, dependencies) }
  } catch (error) {
    if (error instanceof SandboxDependencyError) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: error.message, issues: error.issues },
          { status: 400 }
        ),
      }
    }
    throw error
  }
}

/**
 * Whether a write failed because it collided with the workspace/name unique
 * index. Both paths pre-check the name, but the index is the real arbiter and a
 * concurrent write can still lose the race — which is a 409, not a 500.
 */
export function isNameConflictError(error: unknown): boolean {
  const message = getErrorMessage(error)
  return message.includes(WORKSPACE_SANDBOX_NAME_INDEX) || message.includes('23505')
}

/**
 * Authenticates, authorizes, entitles, and rate-limits a sandbox mutation — in
 * that order, and always before any untrusted input is parsed.
 *
 * Shared by both route files so the create path and the edit/delete path cannot
 * drift into different checks.
 */
export async function authorizeSandboxMutation(
  workspaceId: string
): Promise<{ ok: true; actor: SandboxMutationActor } | { ok: false; response: NextResponse }> {
  const session = await getSession()
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (permission !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json({ error: SANDBOX_ADMIN_REQUIRED }, { status: 403 }),
    }
  }
  // The kill switch runs before the plan gate so an operator who disables the
  // feature mid-incident gets "unavailable", not a misleading upsell.
  if (!(await isFeatureEnabled('custom-sandboxes', { userId: session.user.id }))) {
    return {
      ok: false,
      response: NextResponse.json({ error: SANDBOXES_UNAVAILABLE }, { status: 403 }),
    }
  }
  if (!(await hasWorkspaceSandboxAccess(workspaceId))) {
    return {
      ok: false,
      response: NextResponse.json({ error: MAX_PLAN_REQUIRED }, { status: 403 }),
    }
  }
  const limited = await enforceWorkspaceRateLimit(
    'sandbox-mutations',
    workspaceId,
    SANDBOX_MUTATION_LIMIT
  )
  if (limited) return { ok: false, response: limited }

  return {
    ok: true,
    actor: { userId: session.user.id, name: session.user.name, email: session.user.email },
  }
}

/** Reads a workspace sandbox list; any member may look, only admins may write. */
export async function authorizeSandboxRead(
  _request: NextRequest,
  workspaceId: string
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const session = await getSession()
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const permission = await getUserEntityPermissions(session.user.id, 'workspace', workspaceId)
  if (!permission) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  return { ok: true, userId: session.user.id }
}
