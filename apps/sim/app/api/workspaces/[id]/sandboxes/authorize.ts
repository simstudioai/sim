import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { enforceWorkspaceRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import {
  MAX_PLAN_REQUIRED,
  SANDBOX_ADMIN_REQUIRED,
  SANDBOX_MUTATION_LIMIT,
  type SandboxWriteFailure,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

export interface SandboxMutationActor {
  userId: string
  name?: string | null
  email?: string | null
}

/**
 * Maps a refused write onto the status code the editor expects. Shared by both
 * route files so the create path and the edit/delete path cannot describe the
 * same failure differently.
 *
 * `invalid_dependencies` carries a line number per rejected row, which the
 * generic validation error does not — the editor marks those inline.
 */
export function sandboxFailureResponse(failure: SandboxWriteFailure): NextResponse {
  switch (failure.code) {
    case 'name_conflict':
      return NextResponse.json(
        { error: `A sandbox named "${failure.name}" already exists in this workspace` },
        { status: 409 }
      )
    case 'invalid_dependencies':
      return NextResponse.json({ error: failure.message, issues: failure.issues }, { status: 400 })
    case 'not_found':
      return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 })
    case 'read_back_failed':
      return NextResponse.json({ error: 'Failed to read back the saved sandbox' }, { status: 500 })
  }
}

/**
 * Authenticates, authorizes, entitles, and rate-limits a sandbox mutation — in
 * that order, and always before any untrusted input is parsed.
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
