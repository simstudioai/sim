import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import type { DataRetentionSettings } from '@sim/db/schema'
import { member, organization, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, inArray } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import {
  type OrganizationRetentionValues,
  updateOrganizationDataRetentionContract,
} from '@/lib/api/contracts/organization'
import { parseRequest, validationErrorResponse } from '@/lib/api/server'
import { getSession } from '@/lib/auth'
import { CLEANUP_CONFIG } from '@/lib/billing/cleanup-dispatcher'
import { isOrganizationOnEnterprisePlan } from '@/lib/billing/core/subscription'
import { isBillingEnabled } from '@/lib/core/config/env-flags'
import { isFeatureEnabled } from '@/lib/core/config/feature-flags'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'
import { coercePiiLanguage } from '@/lib/guardrails/pii-entities'

const logger = createLogger('DataRetentionAPI')

function enterpriseDefaults(): OrganizationRetentionValues {
  return {
    logRetentionHours: CLEANUP_CONFIG['cleanup-logs'].defaults.enterprise,
    softDeleteRetentionHours: CLEANUP_CONFIG['cleanup-soft-deletes'].defaults.enterprise,
    taskCleanupHours: CLEANUP_CONFIG['cleanup-tasks'].defaults.enterprise,
    piiRedaction: null,
    retentionOverrides: null,
  }
}

function normalizeConfigured(
  settings: DataRetentionSettings | null | undefined
): OrganizationRetentionValues {
  return {
    logRetentionHours: settings?.logRetentionHours ?? null,
    softDeleteRetentionHours: settings?.softDeleteRetentionHours ?? null,
    taskCleanupHours: settings?.taskCleanupHours ?? null,
    piiRedaction: settings?.piiRedaction?.rules
      ? {
          rules: settings.piiRedaction.rules.map((rule) => ({
            ...rule,
            language: coercePiiLanguage(rule.language),
            stages: rule.stages
              ? {
                  input: {
                    ...rule.stages.input,
                    language: coercePiiLanguage(rule.stages.input?.language),
                  },
                  blockOutputs: {
                    ...rule.stages.blockOutputs,
                    language: coercePiiLanguage(rule.stages.blockOutputs?.language),
                  },
                  logs: {
                    ...rule.stages.logs,
                    language: coercePiiLanguage(rule.stages.logs?.language),
                  },
                }
              : undefined,
          })),
        }
      : null,
    retentionOverrides: settings?.retentionOverrides ?? null,
  }
}

/**
 * Which granular stages (`input`/`blockOutputs`) are already enabled per rule
 * target (`workspaceId ?? ''` = the org default). Used to gate the
 * `pii-granular-redaction` flag on *new* enablement only: when the flag is off,
 * an org that already configured granular stages must still be able to re-save
 * unrelated settings (the UI re-sends the full PII snapshot every save), so we
 * reject only a stage transitioning off→on, never a preserved one.
 */
function granularStageEnablement(
  settings: OrganizationRetentionValues['piiRedaction']
): Map<string, { input: boolean; blockOutputs: boolean }> {
  const map = new Map<string, { input: boolean; blockOutputs: boolean }>()
  for (const rule of settings?.rules ?? []) {
    map.set(rule.workspaceId ?? '', {
      input: rule.stages?.input?.enabled === true,
      blockOutputs: rule.stages?.blockOutputs?.enabled === true,
    })
  }
  return map
}

/**
 * GET /api/organizations/[id]/data-retention
 * Returns the organization's data retention settings.
 * Accessible by any member of the organization.
 */
export const GET = withRouteHandler(
  async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
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
      .select({ dataRetentionSettings: organization.dataRetentionSettings })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const isEnterprise = !isBillingEnabled || (await isOrganizationOnEnterprisePlan(organizationId))
    const [piiRedactionEnabled, piiGranularRedactionEnabled] = await Promise.all([
      isFeatureEnabled('pii-redaction'),
      isFeatureEnabled('pii-granular-redaction'),
    ])
    const configured = normalizeConfigured(org.dataRetentionSettings)
    const defaults = enterpriseDefaults()

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise,
        defaults,
        configured,
        effective: isEnterprise ? configured : defaults,
        piiRedactionEnabled,
        piiGranularRedactionEnabled,
      },
    })
  }
)

/**
 * PUT /api/organizations/[id]/data-retention
 * Updates the organization's data retention settings.
 * Requires enterprise plan and owner/admin role.
 */
export const PUT = withRouteHandler(
  async (request: NextRequest, context: { params: Promise<{ id: string }> }) => {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = await parseRequest(updateOrganizationDataRetentionContract, request, context, {
      validationErrorResponse: (err) => validationErrorResponse(err, 'Invalid request body'),
    })
    if (!parsed.success) return parsed.response

    const { id: organizationId } = parsed.data.params
    const body = parsed.data.body

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
        { error: 'Forbidden - Only organization owners and admins can update data retention' },
        { status: 403 }
      )
    }

    if (isBillingEnabled) {
      const hasEnterprise = await isOrganizationOnEnterprisePlan(organizationId)
      if (!hasEnterprise) {
        return NextResponse.json(
          { error: 'Data Retention is available on Enterprise plans only' },
          { status: 403 }
        )
      }
    }

    const [currentOrg] = await db
      .select({
        name: organization.name,
        dataRetentionSettings: organization.dataRetentionSettings,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    if (!currentOrg) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 })
    }

    const [piiRedactionEnabled, piiGranularRedactionEnabled] = await Promise.all([
      isFeatureEnabled('pii-redaction'),
      isFeatureEnabled('pii-granular-redaction'),
    ])

    const current = normalizeConfigured(currentOrg.dataRetentionSettings)
    const merged: DataRetentionSettings = { ...current }
    if (body.logRetentionHours !== undefined) {
      merged.logRetentionHours = body.logRetentionHours
    }
    if (body.softDeleteRetentionHours !== undefined) {
      merged.softDeleteRetentionHours = body.softDeleteRetentionHours
    }
    if (body.taskCleanupHours !== undefined) {
      merged.taskCleanupHours = body.taskCleanupHours
    }
    if (body.piiRedaction !== undefined) {
      if (!piiRedactionEnabled) {
        return NextResponse.json(
          { error: 'PII redaction is not enabled for this organization' },
          { status: 403 }
        )
      }
      if (!piiGranularRedactionEnabled) {
        // Reject only a granular stage transitioning off→on; a body that merely
        // preserves already-enabled granular stages must still save (the UI
        // re-sends the full snapshot on every save), so existing orgs aren't
        // locked out of unrelated retention changes when the flag is off.
        const currentGranular = granularStageEnablement(current.piiRedaction)
        const newlyEnablesGranular = (body.piiRedaction?.rules ?? []).some((rule) => {
          const cur = currentGranular.get(rule.workspaceId ?? '')
          return (
            (rule.stages?.input?.enabled === true && !cur?.input) ||
            (rule.stages?.blockOutputs?.enabled === true && !cur?.blockOutputs)
          )
        })
        if (newlyEnablesGranular) {
          return NextResponse.json(
            {
              error:
                'Granular PII redaction (workflow input and block outputs) is not enabled for this organization',
            },
            { status: 403 }
          )
        }
      }
      merged.piiRedaction = body.piiRedaction
    }
    if (body.retentionOverrides !== undefined) {
      merged.retentionOverrides = body.retentionOverrides
    }

    const targetedWorkspaceIds = new Set<string>()
    for (const override of body.retentionOverrides ?? []) {
      targetedWorkspaceIds.add(override.workspaceId)
    }
    for (const rule of body.piiRedaction?.rules ?? []) {
      if (rule.workspaceId) targetedWorkspaceIds.add(rule.workspaceId)
    }
    if (targetedWorkspaceIds.size > 0) {
      const ids = [...targetedWorkspaceIds]
      const orgWorkspaces = await db
        .select({ id: workspace.id })
        .from(workspace)
        .where(and(eq(workspace.organizationId, organizationId), inArray(workspace.id, ids)))
      const known = new Set(orgWorkspaces.map((row) => row.id))
      const unknown = ids.filter((id) => !known.has(id))
      if (unknown.length > 0) {
        return NextResponse.json(
          { error: `Override targets workspaces outside this organization: ${unknown.join(', ')}` },
          { status: 400 }
        )
      }
    }

    const [updated] = await db
      .update(organization)
      .set({ dataRetentionSettings: merged, updatedAt: new Date() })
      .where(eq(organization.id, organizationId))
      .returning({ dataRetentionSettings: organization.dataRetentionSettings })

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
      description: 'Updated data retention settings',
      metadata: { changes: body },
      request,
    })

    const configured = normalizeConfigured(updated.dataRetentionSettings)
    const defaults = enterpriseDefaults()

    return NextResponse.json({
      success: true,
      data: {
        isEnterprise: true,
        defaults,
        configured,
        effective: configured,
        piiRedactionEnabled,
        piiGranularRedactionEnabled,
      },
    })
  }
)
