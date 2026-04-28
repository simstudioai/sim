import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import { member, organization } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { HEX_COLOR_REGEX } from '@/lib/branding'
import type { OrganizationWhitelabelSettings } from '@/lib/branding/types'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('WhitelabelAPI')

const updateWhitelabelSchema = z.object({
  brandName: z
    .string()
    .trim()
    .max(64, 'Brand name must be 64 characters or fewer')
    .nullable()
    .optional(),
  logoUrl: z.string().min(1).nullable().optional(),
  wordmarkUrl: z.string().min(1).nullable().optional(),
  primaryColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Primary color must be a valid hex color (e.g. #701ffc)')
    .nullable()
    .optional(),
  primaryHoverColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Primary hover color must be a valid hex color')
    .nullable()
    .optional(),
  accentColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Accent color must be a valid hex color')
    .nullable()
    .optional(),
  accentHoverColor: z
    .string()
    .regex(HEX_COLOR_REGEX, 'Accent hover color must be a valid hex color')
    .nullable()
    .optional(),
  supportEmail: z
    .string()
    .email('Support email must be a valid email address')
    .nullable()
    .optional(),
  documentationUrl: z.string().url('Documentation URL must be a valid URL').nullable().optional(),
  termsUrl: z.string().url('Terms URL must be a valid URL').nullable().optional(),
  privacyUrl: z.string().url('Privacy URL must be a valid URL').nullable().optional(),
  hidePoweredBySim: z.boolean().optional(),
})

/**
 * GET /api/organizations/[id]/whitelabel
 * Returns the organization's whitelabel settings.
 * Accessible by any member of the organization.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId } = await params

      const [memberEntry] = await db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (!memberEntry) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      const [org] = await db
        .select({ whitelabelSettings: organization.whitelabelSettings })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!org) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        data: (org.whitelabelSettings ?? {}) as OrganizationWhitelabelSettings,
      })
    } catch (error) {
      logger.error('Failed to get whitelabel settings', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)

/**
 * PUT /api/organizations/[id]/whitelabel
 * Updates the organization's whitelabel settings.
 * Requires enterprise plan and owner/admin role.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    try {
      const session = await getSession()

      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const { id: organizationId } = await params

      const body = await request.json()
      const parsed = updateWhitelabelSchema.safeParse(body)

      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.errors[0]?.message ?? 'Invalid request body' },
          { status: 400 }
        )
      }

      const [memberEntry] = await db
        .select({ role: member.role })
        .from(member)
        .where(and(eq(member.organizationId, organizationId), eq(member.userId, session.user.id)))
        .limit(1)

      if (!memberEntry) {
        return NextResponse.json(
          { error: 'Forbidden - Not a member of this organization' },
          { status: 403 }
        )
      }

      if (memberEntry.role !== 'owner' && memberEntry.role !== 'admin') {
        return NextResponse.json(
          {
            error: 'Forbidden - Only organization owners and admins can update whitelabel settings',
          },
          { status: 403 }
        )
      }

      const hasEnterprisePlan = await isOrganizationOnEnterprisePlan(organizationId)

      if (!hasEnterprisePlan) {
        return NextResponse.json(
          { error: 'Whitelabeling is available on Enterprise plans only' },
          { status: 403 }
        )
      }

      const [currentOrg] = await db
        .select({ name: organization.name, whitelabelSettings: organization.whitelabelSettings })
        .from(organization)
        .where(eq(organization.id, organizationId))
        .limit(1)

      if (!currentOrg) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      const current: OrganizationWhitelabelSettings = currentOrg.whitelabelSettings ?? {}
      const incoming = parsed.data

      const merged: OrganizationWhitelabelSettings = { ...current }

      for (const key of Object.keys(incoming) as Array<keyof typeof incoming>) {
        const value = incoming[key]
        if (value === null) {
          delete merged[key as keyof OrganizationWhitelabelSettings]
        } else if (value !== undefined) {
          ;(merged as Record<string, unknown>)[key] = value
        }
      }

      const [updated] = await db
        .update(organization)
        .set({ whitelabelSettings: merged, updatedAt: new Date() })
        .where(eq(organization.id, organizationId))
        .returning({ whitelabelSettings: organization.whitelabelSettings })

      if (!updated) {
        return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
      }

      recordAudit({
        workspaceId: null,
        actorId: session.user.id,
        action: AuditAction.ORGANIZATION_UPDATED,
        resourceType: AuditResourceType.ORGANIZATION,
        resourceId: organizationId,
        actorName: session.user.name ?? undefined,
        actorEmail: session.user.email ?? undefined,
        resourceName: currentOrg.name,
        description: 'Updated organization whitelabel settings',
        metadata: { changes: Object.keys(incoming) },
        request,
      })

      return NextResponse.json({
        success: true,
        data: (updated.whitelabelSettings ?? {}) as OrganizationWhitelabelSettings,
      })
    } catch (error) {
      logger.error('Failed to update whitelabel settings', { error })
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
)
