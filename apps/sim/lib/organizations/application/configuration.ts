import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import {
  type DataRetentionSettings,
  organization,
  type SessionPolicySettings,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  OrganizationRetentionValues,
  UpdateOrganizationDataRetentionBody,
  UpdateOrganizationSessionPolicyBody,
  updateOrganizationWhitelabelBodySchema,
} from '@/lib/api/contracts/organization'
import { invalidateSecurityPolicyVersionCache } from '@/lib/auth/security-policy'
import { eagerClampOrgSessions, invalidateSessionPolicyCache } from '@/lib/auth/session-policy'
import { CLEANUP_CONFIG } from '@/lib/billing/cleanup-dispatcher'
import {
  isOrganizationFeatureEntitled,
  isOrganizationOnEnterprisePlan,
} from '@/lib/billing/core/subscription'
import { getForeignWorkspaceTargetsReason } from '@/lib/billing/retention'
import type { OrganizationWhitelabelSettings } from '@/lib/branding/types'
import {
  isBillingEnabled,
  isSessionPoliciesEnabled,
  isWhitelabelingEnabled,
} from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { coercePiiLanguage } from '@/lib/guardrails/pii-entities'
import { defineOrganizationConfigurationUseCase } from '@/lib/organizations/application/authorized-configuration-use-case'
import { organizationConfigurationOperations } from '@/lib/organizations/application/configuration-operations'

const logger = createLogger('OrganizationConfiguration')

interface OrganizationInput {
  organizationId: string
}

type WhitelabelInput = OrganizationInput & {
  settings: z.input<typeof updateOrganizationWhitelabelBodySchema>
}
type SessionPolicyInput = OrganizationInput & { settings: UpdateOrganizationSessionPolicyBody }
type DataRetentionInput = OrganizationInput & { settings: UpdateOrganizationDataRetentionBody }

function requireOrganization<T>(row: T | undefined): T {
  if (!row) throw new OrchestrationError('not_found', 'Organization not found')
  return row
}

function configuredSessionPolicy(settings: SessionPolicySettings | null | undefined) {
  return {
    maxSessionHours: settings?.maxSessionHours ?? null,
    idleTimeoutHours: settings?.idleTimeoutHours ?? null,
  }
}

function retentionDefaults(): OrganizationRetentionValues {
  return {
    logRetentionHours: CLEANUP_CONFIG['cleanup-logs'].defaults.enterprise,
    softDeleteRetentionHours: CLEANUP_CONFIG['cleanup-soft-deletes'].defaults.enterprise,
    taskCleanupHours: CLEANUP_CONFIG['cleanup-tasks'].defaults.enterprise,
    fileVersionRetentionHours: CLEANUP_CONFIG['cleanup-file-versions'].defaults.enterprise,
    piiRedaction: null,
    retentionOverrides: null,
  }
}

function configuredRetention(
  settings: DataRetentionSettings | null | undefined
): OrganizationRetentionValues {
  return {
    logRetentionHours: settings?.logRetentionHours ?? null,
    softDeleteRetentionHours: settings?.softDeleteRetentionHours ?? null,
    taskCleanupHours: settings?.taskCleanupHours ?? null,
    fileVersionRetentionHours: settings?.fileVersionRetentionHours ?? null,
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

export const getOrganizationWhitelabel = defineOrganizationConfigurationUseCase({
  operation: organizationConfigurationOperations.readWhitelabel,
  async execute({ input }: { input: OrganizationInput }) {
    const [row] = await db
      .select({ settings: organization.whitelabelSettings })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
    return requireOrganization(row).settings ?? {}
  },
})

export const updateOrganizationWhitelabel = defineOrganizationConfigurationUseCase({
  operation: organizationConfigurationOperations.updateWhitelabel,
  administratorError:
    'Forbidden - Only organization owners and admins can update whitelabel settings',
  async execute({ input }: { input: WhitelabelInput }) {
    if (!(await isOrganizationFeatureEntitled(input.organizationId, isWhitelabelingEnabled))) {
      throw new OrchestrationError(
        'forbidden',
        isBillingEnabled
          ? 'Whitelabeling is available on Enterprise plans only'
          : 'Whitelabeling is disabled. Set ENTERPRISE_ENABLED or WHITELABELING_ENABLED to enable it.'
      )
    }
    const [row] = await db
      .select({ name: organization.name, settings: organization.whitelabelSettings })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
    const current = requireOrganization(row)
    const merged: OrganizationWhitelabelSettings = { ...current.settings }
    for (const key of Object.keys(input.settings) as Array<keyof typeof input.settings>) {
      if (key === 'hidePoweredBySim') {
        if (input.settings.hidePoweredBySim !== undefined) {
          merged.hidePoweredBySim = input.settings.hidePoweredBySim
        }
        continue
      }
      const value = input.settings[key]
      if (value === null) delete merged[key]
      else if (value !== undefined) merged[key] = value
    }
    const [updated] = await db
      .update(organization)
      .set({ whitelabelSettings: merged, updatedAt: new Date() })
      .where(eq(organization.id, input.organizationId))
      .returning({ settings: organization.whitelabelSettings })
    return { data: requireOrganization(updated).settings ?? {}, organizationName: current.name }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    resourceName: result.organizationName,
    description: 'Updated organization whitelabel settings',
    metadata: { changes: Object.keys(input.settings) },
  }),
})

export const getOrganizationSessionPolicy = defineOrganizationConfigurationUseCase({
  operation: organizationConfigurationOperations.readSessionPolicy,
  async execute({ input }: { input: OrganizationInput }) {
    const [row] = await db
      .select({ sessionPolicySettings: organization.sessionPolicySettings })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
    const current = requireOrganization(row)
    return {
      isEnterprise: await isOrganizationFeatureEntitled(
        input.organizationId,
        isSessionPoliciesEnabled
      ),
      configured: configuredSessionPolicy(current.sessionPolicySettings),
    }
  },
})

export const updateOrganizationSessionPolicy = defineOrganizationConfigurationUseCase({
  operation: organizationConfigurationOperations.updateSessionPolicy,
  administratorError:
    'Forbidden - Only organization owners and admins can update the session policy',
  async execute({ input }: { input: SessionPolicyInput }) {
    if (!(await isOrganizationFeatureEntitled(input.organizationId, isSessionPoliciesEnabled))) {
      throw new OrchestrationError(
        'forbidden',
        isBillingEnabled
          ? 'Session policies are available on Enterprise plans only'
          : 'Session policies are disabled. Set ENTERPRISE_ENABLED or SESSION_POLICIES_ENABLED to enable them.'
      )
    }
    const [row] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
    const current = requireOrganization(row)
    const settings = configuredSessionPolicy(input.settings)
    const updated = await db.transaction(async (tx) => {
      const [result] = await tx
        .update(organization)
        .set({
          sessionPolicySettings: settings,
          securityPolicyVersion: sql`${organization.securityPolicyVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(organization.id, input.organizationId))
        .returning({ id: organization.id })
      if (!result) return undefined
      await eagerClampOrgSessions(input.organizationId, settings, tx)
      return result
    })
    requireOrganization(updated)
    invalidateSessionPolicyCache(input.organizationId)
    invalidateSecurityPolicyVersionCache(input.organizationId)
    logger.info('Updated organization session policy', { organizationId: input.organizationId })
    return {
      data: { isEnterprise: true, configured: settings },
      organizationName: current.name,
    }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORGANIZATION_SESSION_POLICY_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    resourceName: result.organizationName,
    description: 'Updated session policy',
    metadata: { changes: input.settings },
  }),
})

export const getOrganizationDataRetention = defineOrganizationConfigurationUseCase({
  operation: organizationConfigurationOperations.readDataRetention,
  async execute({ input }: { input: OrganizationInput }) {
    const [row] = await db
      .select({ settings: organization.dataRetentionSettings })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
    const current = requireOrganization(row)
    const isEnterprise =
      !isBillingEnabled || (await isOrganizationOnEnterprisePlan(input.organizationId))
    const configured = configuredRetention(current.settings)
    const defaults = retentionDefaults()
    return { isEnterprise, defaults, configured, effective: isEnterprise ? configured : defaults }
  },
})

export const updateOrganizationDataRetention = defineOrganizationConfigurationUseCase({
  operation: organizationConfigurationOperations.updateDataRetention,
  administratorError: 'Forbidden - Only organization owners and admins can update data retention',
  async execute({ input }: { input: DataRetentionInput }) {
    if (isBillingEnabled && !(await isOrganizationOnEnterprisePlan(input.organizationId))) {
      throw new OrchestrationError(
        'forbidden',
        'Data Retention is available on Enterprise plans only'
      )
    }
    const [row] = await db
      .select({ name: organization.name, settings: organization.dataRetentionSettings })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .limit(1)
    const current = requireOrganization(row)
    const merged: DataRetentionSettings = { ...configuredRetention(current.settings) }
    const body = input.settings
    if (body.logRetentionHours !== undefined) merged.logRetentionHours = body.logRetentionHours
    if (body.softDeleteRetentionHours !== undefined)
      merged.softDeleteRetentionHours = body.softDeleteRetentionHours
    if (body.taskCleanupHours !== undefined) merged.taskCleanupHours = body.taskCleanupHours
    if (body.fileVersionRetentionHours !== undefined)
      merged.fileVersionRetentionHours = body.fileVersionRetentionHours
    if (body.piiRedaction !== undefined) merged.piiRedaction = body.piiRedaction
    if (body.retentionOverrides !== undefined) merged.retentionOverrides = body.retentionOverrides
    const reason = await getForeignWorkspaceTargetsReason({
      organizationId: input.organizationId,
      retentionOverrides: body.retentionOverrides,
      piiRedaction: body.piiRedaction,
    })
    if (reason) throw new OrchestrationError('validation', reason)
    const [updated] = await db
      .update(organization)
      .set({ dataRetentionSettings: merged, updatedAt: new Date() })
      .where(eq(organization.id, input.organizationId))
      .returning({ settings: organization.dataRetentionSettings })
    const configured = configuredRetention(requireOrganization(updated).settings)
    return {
      data: {
        isEnterprise: true,
        defaults: retentionDefaults(),
        configured,
        effective: configured,
      },
      organizationName: current.name,
    }
  },
  projectAudit: ({ input, result }) => ({
    action: AuditAction.ORGANIZATION_UPDATED,
    resourceType: AuditResourceType.ORGANIZATION,
    resourceId: input.organizationId,
    resourceName: result.organizationName,
    description: 'Updated data retention settings',
    metadata: { changes: input.settings },
  }),
})
