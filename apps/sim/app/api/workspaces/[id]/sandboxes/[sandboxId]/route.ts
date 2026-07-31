import { db } from '@sim/db'
import { workspaceSandbox } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { deleteSandboxContract, updateSandboxContract } from '@/lib/api/contracts/sandboxes'
import { parseRequest } from '@/lib/api/server'
import { runDetached } from '@/lib/core/utils/background'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { releaseSandboxImage } from '@/lib/execution/remote-sandbox/image-registry'
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

  // Unconditional, because the registry decides what a save costs: a `ready` or
  // in-flight row is left alone, so renaming or re-saving an unchanged spec
  // enqueues nothing, while a failed one gets the immediate retry a person saving
  // is asking for. Gating this on a changed hash meant a same-spec save silently
  // did nothing, and the only way to retry a failed build was to edit the package
  // list into a different hash.
  await scheduleSandboxBuild(spec)

  if (spec.specHash !== existing.specHash) {
    // The previous content address is unreferenced by this sandbox now. Release
    // no-ops when another sandbox still declares the same package list.
    runDetached('release-sandbox-image', () => releaseSandboxImage(existing.specHash))
    logger.info('Sandbox spec changed, scheduled a build', { workspaceId, sandboxId })
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
    .returning({ id: workspaceSandbox.id, specHash: workspaceSandbox.specHash })

  if (deleted.length === 0) {
    return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 })
  }

  invalidateSandboxResolution()
  // Detached: the row is already gone, so the caller's delete succeeded whatever
  // the provider says. Awaiting would hold a UI delete open on a remote call the
  // retention sweep would retry anyway.
  runDetached('release-sandbox-image', () => releaseSandboxImage(deleted[0].specHash))
  logger.info('Deleted workspace sandbox', { workspaceId, sandboxId })
  return NextResponse.json({ success: true })
})
