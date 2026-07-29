import { db } from '@sim/db'
import { workspaceSandbox } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteSandboxContract, updateSandboxContract } from '@/lib/api/contracts/sandboxes'
import { parseRequest } from '@/lib/api/server'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { invalidateSandboxResolution } from '@/lib/execution/remote-sandbox/resolve'
import {
  isSandboxNameTaken,
  readWorkspaceSandbox,
  scheduleSandboxBuild,
} from '@/lib/execution/remote-sandbox/workspace-sandboxes'
import {
  authorizeSandboxMutation,
  buildSpecOrResponse,
  isNameConflictError,
  nameConflictResponse,
} from '@/app/api/workspaces/[id]/sandboxes/authorize'

const logger = createLogger('WorkspaceSandboxAPI')

type SandboxContext = { params: Promise<{ id: string; sandboxId: string }> }

export const PATCH = withRouteHandler(async (request: NextRequest, context: SandboxContext) => {
  const { id: workspaceId, sandboxId } = await context.params

  const authorized = await authorizeSandboxMutation(workspaceId)
  if (!authorized.ok) return authorized.response

  const parsed = await parseRequest(updateSandboxContract, request, context)
  if (!parsed.success) return parsed.response
  const { name, language, dependencies } = parsed.data.body

  const [existing] = await db
    .select({
      id: workspaceSandbox.id,
      name: workspaceSandbox.name,
      language: workspaceSandbox.language,
      dependencies: workspaceSandbox.dependencies,
      specHash: workspaceSandbox.specHash,
    })
    .from(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .limit(1)

  if (!existing) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 })
  }

  const nextName = name ?? existing.name
  if (name && name !== existing.name && (await isSandboxNameTaken(workspaceId, name, sandboxId))) {
    return nameConflictResponse(name)
  }

  // Both halves are revalidated together even when only one changed: switching
  // language has to re-check the existing list against the new language's rules,
  // and editing dependencies has to check them against the stored language.
  const nextLanguage = language ?? (existing.language as 'javascript' | 'python')
  const nextDependencies = dependencies ?? existing.dependencies ?? []

  const built = buildSpecOrResponse(nextLanguage, nextDependencies)
  if (!built.ok) return built.response
  const { spec } = built

  try {
    await db
      .update(workspaceSandbox)
      .set({
        name: nextName,
        language: spec.language,
        dependencies: spec.dependencies,
        specHash: spec.specHash,
        updatedAt: new Date(),
      })
      // Scoped by workspace as well as id: every other query here is, and relying on
      // the SELECT above to have 404'd first makes authz an ordering invariant.
      .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
  } catch (error) {
    // The pre-check above can lose a race with a concurrent rename; the unique
    // index is the real arbiter, and losing it is a conflict, not a server fault.
    if (isNameConflictError(error)) return nameConflictResponse(nextName)
    throw error
  }

  // An unchanged spec re-points at the same content address, so `ensureSandboxImage`
  // finds a `ready` row and enqueues nothing. Editing the name alone costs no build.
  if (spec.specHash !== existing.specHash) {
    await scheduleSandboxBuild(spec)
    logger.info('Sandbox spec changed, scheduled a build', { workspaceId, sandboxId })
  } else {
    invalidateSandboxResolution()
  }

  const sandbox = await readWorkspaceSandbox(workspaceId, sandboxId)
  if (!sandbox) {
    return NextResponse.json({ error: 'Failed to read back the updated sandbox' }, { status: 500 })
  }
  return NextResponse.json({ sandbox })
})

export const DELETE = withRouteHandler(async (request: NextRequest, context: SandboxContext) => {
  const { id: workspaceId, sandboxId } = await context.params

  const authorized = await authorizeSandboxMutation(workspaceId)
  if (!authorized.ok) return authorized.response

  const parsed = await parseRequest(deleteSandboxContract, request, context)
  if (!parsed.success) return parsed.response

  // A block may still reference this sandbox. Deleting is allowed anyway; that
  // execution then fails closed with a message naming the missing sandbox,
  // rather than silently falling back to an image without its dependencies.
  const deleted = await db
    .delete(workspaceSandbox)
    .where(and(eq(workspaceSandbox.id, sandboxId), eq(workspaceSandbox.workspaceId, workspaceId)))
    .returning({ id: workspaceSandbox.id })

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 })
  }

  invalidateSandboxResolution()
  logger.info('Deleted workspace sandbox', { workspaceId, sandboxId })
  return NextResponse.json({ success: true })
})
