import { type NextRequest, NextResponse } from 'next/server'
import type { SandboxValidationError } from '@/lib/api/contracts/sandboxes'
import { getSession } from '@/lib/auth'
import { hasWorkspaceSandboxAccess } from '@/lib/billing/core/subscription'
import { enforceWorkspaceRateLimit } from '@/lib/core/rate-limiter/route-helpers'
import {
  MAX_PLAN_REQUIRED,
  SANDBOX_ADMIN_REQUIRED,
  SANDBOX_MUTATION_LIMIT,
  SandboxDependencyError,
  SandboxSystemPackageError,
  WorkspaceSandboxNameConflictError,
  WorkspaceSandboxNotFoundError,
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

/** Maps shared sandbox-service errors onto the HTTP contract. */
export function sandboxMutationErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof WorkspaceSandboxNameConflictError) {
    return nameConflictResponse(error.sandboxName)
  }
  if (error instanceof WorkspaceSandboxNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  if (error instanceof SandboxSystemPackageError) {
    const body = {
      error: error.message,
      issueField: 'systemPackages',
      issues: error.issues,
    } satisfies SandboxValidationError
    return NextResponse.json(body, { status: 400 })
  }
  if (error instanceof SandboxDependencyError) {
    const body = {
      error: error.message,
      issueField: 'dependencies',
      issues: error.issues,
    } satisfies SandboxValidationError
    return NextResponse.json(body, { status: 400 })
  }
  return null
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
