import { NextResponse } from 'next/server'
import {
  CAPABILITY_RULES,
  capabilityRefusal,
  type PermissionGroupCapability,
} from '@/lib/permission-groups/capabilities'

/**
 * The 403 a raw route returns when a permission group withholds a capability,
 * as opposed to the caller's role being too low.
 *
 * One builder so the sentence and the detail code cannot drift between the
 * routes that gate through a shared access check, the ones that assert inline,
 * and the ones that catch {@link PermissionGroupCapabilityError} and render its
 * capability. The detail code is read off the rule rather than spelled out at
 * the call site — four capabilities carry a more specific one, and a literal
 * would report them as the generic block.
 *
 * The v1 public API renders its own `{ error: { code, message } }` envelope and
 * is deliberately not converged here; see `resolveCapabilityRefusal` in
 * `app/api/v1/middleware.ts`.
 */
export function capabilityRefusalResponse(capability: PermissionGroupCapability): NextResponse {
  return NextResponse.json(
    {
      error: capabilityRefusal(capability),
      details: { code: CAPABILITY_RULES[capability].detailCode },
    },
    { status: 403 }
  )
}
