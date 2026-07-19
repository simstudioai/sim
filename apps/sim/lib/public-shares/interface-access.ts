import type { publicShare } from '@sim/db/schema'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { validateDeploymentAuth } from '@/lib/core/security/deployment-auth'
import type {
  InterfaceDefinition,
  InterfaceModule,
  InterfaceModuleType,
  ModuleReference,
} from '@/lib/interfaces'
import { moduleReference } from '@/lib/interfaces'
import { resolveActiveInterfaceShareByToken } from '@/lib/public-shares/share-manager'

/** The deployment-auth cookie namespace for interface shares (`interface_auth_{shareId}`). */
const AUTH_KIND = 'interface' as const

/** The share-level half of the chain: the token resolved and the auth gate passed. */
interface PublicInterfaceShareAccess {
  share: typeof publicShare.$inferSelect
  /** The stored definition — the only authority for what this token grants. */
  definition: InterfaceDefinition
  /** The interface's own workspace. Every resolved resource must belong to it. */
  workspaceId: string
}

export interface PublicInterfaceModuleAccess extends PublicInterfaceShareAccess {
  module: InterfaceModule
  /** DERIVED from the stored layout. Never client-supplied. */
  resource: ModuleReference
}

/** Uniform refusal, shared by both resolvers so neither can leak a distinguishable failure. */
type PublicInterfaceAccessDenied = { ok: false; response: NextResponse }

type PublicInterfaceShareAccessResult =
  | { ok: true; access: PublicInterfaceShareAccess }
  | PublicInterfaceAccessDenied

export type PublicInterfaceAccessResult =
  | { ok: true; access: PublicInterfaceModuleAccess }
  | PublicInterfaceAccessDenied

/**
 * Unknown token, inactive share, archived interface, missing module, wrong
 * module type, and unconfigured module are all indistinguishable to the caller.
 * The existence of an interface — or of any resource inside it — is never
 * leaked through this path.
 */
function notFound(): PublicInterfaceAccessDenied {
  return { ok: false, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
}

/**
 * Steps 1–2 of the authorization chain: resolve the token to an *active*,
 * non-archived interface share, then run the share auth gate (`public` /
 * `password` / `email` / `sso`) via the same {@link validateDeploymentAuth}
 * implementation deployed chats use. Nothing here derives or exposes a
 * resource; {@link resolvePublicInterfaceModule} adds steps 3–4.
 */
async function authorizePublicInterfaceShare(args: {
  token: string
  request: NextRequest
  requestId: string
  /** Parsed body, for the password/email branches of the auth gate. */
  parsedBody?: { password?: string; email?: string } | null
}): Promise<PublicInterfaceShareAccessResult> {
  const { token, request, requestId, parsedBody } = args

  const resolved = await resolveActiveInterfaceShareByToken(token)
  if (!resolved) return notFound()

  const auth = await validateDeploymentAuth(
    requestId,
    resolved.share,
    request,
    parsedBody ?? undefined,
    AUTH_KIND
  )
  if (!auth.authorized) {
    const response = NextResponse.json(
      { error: auth.error ?? 'auth_required_password' },
      { status: 401 }
    )
    if (auth.status === 429 && auth.retryAfterMs !== undefined) {
      response.headers.set('Retry-After', String(Math.ceil(auth.retryAfterMs / 1000)))
    }
    return { ok: false, response }
  }

  return {
    ok: true,
    access: {
      share: resolved.share,
      definition: resolved.definition,
      workspaceId: resolved.workspaceId,
    },
  }
}

/**
 * The single authorization chain for every public interface data route.
 *
 * A share token is a capability for exactly two things: the interface record it
 * points at, and the one resource each of that interface's *currently stored*
 * modules references. Public routes are addressed by `(token, moduleId)` and
 * accept no `workflowId` / `tableId` / `fileId` parameter at all — the resource
 * id is *produced* here by {@link moduleReference} from the layout re-read from
 * the database on every request, so there is nothing for a caller to forge and
 * no comparison to get wrong.
 *
 * Steps, in order:
 *
 * 1. Token → active share, with `resourceType` pinned to `'interface'` in the
 *    query so a file token can never resolve here.
 * 2. The share auth gate (`public` / `password` / `email` / `sso`), reusing the
 *    same {@link validateDeploymentAuth} implementation as deployed chats.
 *    Steps 1–2 are {@link authorizePublicInterfaceShare}.
 * 3. The module must exist in *this* interface's stored layout, with the type
 *    the route expects — a `/table` route can never address a file module.
 * 4. The module's single resource reference, derived from the stored config.
 *
 * Callers MUST still re-assert that the resolved resource lives in
 * `access.workspaceId` before serving. `validateLayout` grandfathers references
 * that were already present in the previous layout, so a stored reference is
 * only proven in-workspace at the moment it was introduced. That re-check is
 * not redundant and must not be optimized away.
 *
 * Rate limiting is the route's job and straddles this call: the per-IP bucket
 * (`enforcePerIpRateLimit`) runs *before* it, since an unresolved token must not
 * reach the database, and the aggregate per-share bucket
 * (`enforcePerShareRateLimit`) runs *after* it with `access.share.id`, since the
 * share is not known until the token resolves.
 */
export async function resolvePublicInterfaceModule(args: {
  token: string
  moduleId: string
  expectedType: InterfaceModuleType
  request: NextRequest
  requestId: string
  /** Parsed body, for the password/email branches of the auth gate. */
  parsedBody?: { password?: string; email?: string } | null
}): Promise<PublicInterfaceAccessResult> {
  const { token, moduleId, expectedType, request, requestId, parsedBody } = args

  const authorized = await authorizePublicInterfaceShare({ token, request, requestId, parsedBody })
  if (!authorized.ok) return authorized
  const { share, definition, workspaceId } = authorized.access

  const module = definition.layout.modules.find((entry) => entry.id === moduleId)
  if (!module || module.type !== expectedType) return notFound()

  const resource = moduleReference(module)
  if (!resource) return notFound()

  return {
    ok: true,
    access: { share, definition, workspaceId, module, resource },
  }
}
