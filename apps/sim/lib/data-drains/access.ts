import { db } from '@sim/db'
import { dataDrains, member } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled, isDataDrainsEnabled } from '@/lib/core/config/feature-flags'

export interface DrainAccessSession {
  user: {
    id: string
    name?: string | null
    email?: string | null
  }
  membership: {
    role: string
  }
}

export type DrainAccessResult =
  | { ok: true; session: DrainAccessSession }
  | { ok: false; response: NextResponse }

/**
 * Auth + membership + role + enterprise-plan gate shared by every data-drain
 * route. Owner/admin role is required for reads as well as writes since drain
 * configs expose customer bucket names and webhook URLs. On Sim Cloud the
 * gate is the Enterprise plan; on self-hosted it's `DATA_DRAINS_ENABLED`,
 * which 404s when unset so a newer image doesn't silently expose drains.
 */
export async function authorizeDrainAccess(
  organizationId: string,
  options: { requireMutating: boolean }
): Promise<DrainAccessResult> {
  const session = await getSession()
  if (!session?.user?.id) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  const [memberEntry] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
    .limit(1)

  if (!memberEntry) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden - Not a member of this organization' },
        { status: 403 }
      ),
    }
  }

  if (!isBillingEnabled && !isDataDrainsEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Data Drains are not enabled on this deployment' },
        { status: 404 }
      ),
    }
  }
  if (isBillingEnabled) {
    const hasEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
    if (!hasEnterprise) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Data Drains are available on Enterprise plans only' },
          { status: 403 }
        ),
      }
    }
  }
  if (memberEntry.role !== 'owner' && memberEntry.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: options.requireMutating
            ? 'Forbidden - Only organization owners and admins can manage data drains'
            : 'Forbidden - Only organization owners and admins can view data drains',
        },
        { status: 403 }
      ),
    }
  }

  return {
    ok: true,
    session: {
      user: {
        id: session.user.id,
        name: session.user.name ?? null,
        email: session.user.email ?? null,
      },
      membership: { role: memberEntry.role },
    },
  }
}

export async function loadDrain(organizationId: string, drainId: string) {
  const [drain] = await db
    .select()
    .from(dataDrains)
    .where(and(eq(dataDrains.id, drainId), eq(dataDrains.organizationId, organizationId)))
    .limit(1)
  return drain ?? null
}
