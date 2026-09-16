import { z } from 'zod'
import {
  type MothershipSettingsInput,
  mothershipSettingsInputSchema,
} from '@/lib/api/contracts/mothership-settings'
import {
  updateOrganizationDataRetentionBodySchema,
  updateOrganizationSessionPolicyBodySchema,
  updateOrganizationWhitelabelBodySchema,
} from '@/lib/api/contracts/organization'
import { updateUserProfileBodySchema } from '@/lib/api/contracts/user'
import {
  listOrganizationByokKeys,
  readInheritedByokStatus,
} from '@/lib/api-key/application/organization-byok-keys'
import { listPersonalApiKeys } from '@/lib/api-key/application/personal-api-keys'
import { listWorkspaceApiKeys } from '@/lib/api-key/application/workspace-api-keys'
import { listWorkspaceByokKeys } from '@/lib/api-key/application/workspace-byok-keys'
import { getOrganizationBillingSummary } from '@/lib/billing/application/organization-billing-summary/get-organization-billing-summary'
import { getOrganizationUsageSummary } from '@/lib/billing/application/organization-usage/get-organization-usage-summary'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { getOrganizationAccountsSettings } from '@/lib/credential-groups/application/organization-accounts'
import { projectDataDrainForTool } from '@/lib/data-drains/application/tool-projection'
import { listDataDrains } from '@/lib/data-drains/application/use-cases'
import { isKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { listSlackSearchInstallations } from '@/lib/knowledge/application/slack-search/installations'
import { projectSlackSearchSettingsForTool } from '@/lib/knowledge/application/slack-search/settings-projection'
import {
  resolveSettingsContext,
  type SettingsContext,
} from '@/lib/mothership/application/settings-context'
import { inboxSettingsPatchSchema } from '@/lib/mothership/inbox/settings-input'
import type { BaseServerTool } from '@/lib/mothership/tools/server/base-tool'
import { readSettingsUsageLimit } from '@/lib/mothership/tools/server/settings-billing'
import { readArchivedSettingsChats } from '@/lib/mothership/tools/server/settings-chats'
import {
  readSettingsGroups,
  readSettingsRoster,
} from '@/lib/mothership/tools/server/settings-collections'
import {
  parseSettingsArguments,
  settingsWorkspaceId,
} from '@/lib/mothership/tools/server/settings-operation'
import { settingsOperations } from '@/lib/mothership/tools/server/settings-operations'
import { readSettingsDomains } from '@/lib/mothership/tools/server/settings-security'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  getOrganizationDataRetention,
  getOrganizationSessionPolicy,
  getOrganizationWhitelabel,
  updateOrganizationDataRetention,
  updateOrganizationSessionPolicy,
  updateOrganizationWhitelabel,
} from '@/lib/organizations/application/configuration'
import {
  organizationSettingsPatchSchema,
  readOrganizationSettings,
  updateOrganizationSettings,
} from '@/lib/organizations/application/settings'
import { type SettingsSection, settingsSections } from '@/lib/settings/sections'
import {
  delegatedAccountPreferencesSchema,
  updateCurrentUserPreferences,
  updateCurrentUserProfile,
} from '@/lib/users/application/preferences'
import {
  getCurrentUserProfileUseCase,
  getCurrentUserSettingsUseCase,
} from '@/lib/users/application/read-current-user'
import { listCustomBlockSettings } from '@/lib/workflows/custom-blocks/application/settings'
import { readInboxSettings, updateInboxSettings } from '@/lib/workspaces/application/inbox-settings'
import { readWorkspacePermissions } from '@/lib/workspaces/application/manage-permissions'

interface SettingAdapter {
  get(context: SettingsContext): Promise<unknown>
  schema?: z.ZodType
  update?(context: SettingsContext, changes: Record<string, unknown>): Promise<unknown>
}

function organizationInput(context: SettingsContext) {
  if (!context.organizationId) throw new OrchestrationError('not_found', 'Organization not found')
  return { organizationId: context.organizationId }
}

/** Closed adapters call the same application operations as Settings; no route proxy or metadata patch. */
const adapters: Record<string, SettingAdapter> = {
  'workspace/custom-blocks': {
    get: (context) =>
      listCustomBlockSettings.execute({
        principal: context.principal,
        input: { workspaceId: settingsWorkspaceId(context) },
      }),
  },
  'account/billing': { get: readSettingsUsageLimit },
  'organization/sso': { get: readSettingsDomains },
  'workspace/inbox': {
    schema: inboxSettingsPatchSchema.strict(),
    get: (context) =>
      readInboxSettings.execute({
        principal: context.principal,
        input: { workspaceId: settingsWorkspaceId(context) },
      }),
    update: (context, changes) =>
      updateInboxSettings.execute({
        principal: context.principal,
        input: {
          workspaceId: settingsWorkspaceId(context),
          patch: inboxSettingsPatchSchema.strict().parse(changes),
        },
      }),
  },
  'workspace/recently-deleted': { get: readArchivedSettingsChats },
  'organization/recently-deleted': { get: readArchivedSettingsChats },
  'workspace/byok': {
    get: async (context) => {
      const args = {
        principal: context.principal,
        input: { workspaceId: settingsWorkspaceId(context) },
      }
      const [owned, inherited] = await Promise.all([
        listWorkspaceByokKeys.execute(args),
        readInheritedByokStatus.execute(args),
      ])
      return { ...owned, ...inherited }
    },
  },
  'account/api-keys': {
    get: (context) => listPersonalApiKeys.execute({ principal: context.principal, input: {} }),
  },
  'workspace/api-keys': {
    get: (context) =>
      listWorkspaceApiKeys.execute({
        principal: context.principal,
        input: { workspaceId: settingsWorkspaceId(context) },
      }),
  },
  'organization/byok': {
    get: (context) =>
      listOrganizationByokKeys.execute({
        principal: context.principal,
        input: organizationInput(context),
      }),
  },
  'organization/search-slack': {
    get: async (context) =>
      projectSlackSearchSettingsForTool(
        await listSlackSearchInstallations.execute({
          principal: context.principal,
          input: organizationInput(context),
        })
      ),
  },
  'workspace/teammates': {
    get: (context) =>
      readWorkspacePermissions.execute({
        principal: context.principal,
        input: { workspaceId: settingsWorkspaceId(context) },
      }),
  },
  'organization/connected-accounts': {
    get: (context) =>
      getOrganizationAccountsSettings.execute({
        principal: context.principal,
        input: organizationInput(context),
      }),
  },
  'organization/data-drains': {
    get: async (context) => ({
      drains: (
        await listDataDrains.execute({
          principal: context.principal,
          input: { ...organizationInput(context), limit: 100 },
        })
      ).map(projectDataDrainForTool),
    }),
  },
  'organization/access-control': { get: readSettingsGroups },
  'organization/billing': {
    get: (context) =>
      getOrganizationBillingSummary.execute({
        principal: context.principal,
        input: organizationInput(context),
      }),
  },
  'organization/usage': {
    get: (context) =>
      getOrganizationUsageSummary.execute({
        principal: context.principal,
        input: { ...organizationInput(context), preset: 'current-period', timezone: 'UTC' },
      }),
  },
  'account/profile': {
    schema: updateUserProfileBodySchema.strict(),
    get: ({ principal }) => getCurrentUserProfileUseCase.execute({ principal, input: {} }),
    update: ({ principal }, changes) =>
      updateCurrentUserProfile.execute({
        principal,
        input: updateUserProfileBodySchema.strict().parse(changes),
      }),
  },
  'account/preferences': {
    schema: delegatedAccountPreferencesSchema,
    get: ({ principal }) => getCurrentUserSettingsUseCase.execute({ principal, input: {} }),
    update: ({ principal }, changes) =>
      updateCurrentUserPreferences.execute({
        principal,
        input: delegatedAccountPreferencesSchema.parse(changes),
      }),
  },
  'organization/general': {
    schema: organizationSettingsPatchSchema,
    get: (context) =>
      readOrganizationSettings.execute({
        principal: context.principal,
        input: organizationInput(context),
      }),
    update: (context, changes) =>
      updateOrganizationSettings.execute({
        principal: context.principal,
        input: {
          ...organizationInput(context),
          patch: organizationSettingsPatchSchema.parse(changes),
        },
      }),
  },
  'organization/members': { get: readSettingsRoster },
  'organization/whitelabeling': {
    schema: updateOrganizationWhitelabelBodySchema.strict(),
    get: (context) =>
      getOrganizationWhitelabel.execute({
        principal: context.principal,
        input: organizationInput(context),
      }),
    update: async (context, changes) =>
      (
        await updateOrganizationWhitelabel.execute({
          principal: context.principal,
          input: {
            ...organizationInput(context),
            settings: updateOrganizationWhitelabelBodySchema.strict().parse(changes),
          },
        })
      ).data,
  },
  'organization/security': {
    schema: updateOrganizationSessionPolicyBodySchema.strict(),
    get: (context) =>
      getOrganizationSessionPolicy.execute({
        principal: context.principal,
        input: organizationInput(context),
      }),
    update: async (context, changes) =>
      (
        await updateOrganizationSessionPolicy.execute({
          principal: context.principal,
          input: {
            ...organizationInput(context),
            settings: updateOrganizationSessionPolicyBodySchema.strict().parse(changes),
          },
        })
      ).data,
  },
  'organization/data-retention': {
    schema: updateOrganizationDataRetentionBodySchema.strict(),
    get: (context) =>
      getOrganizationDataRetention.execute({
        principal: context.principal,
        input: organizationInput(context),
      }),
    update: async (context, changes) =>
      (
        await updateOrganizationDataRetention.execute({
          principal: context.principal,
          input: {
            ...organizationInput(context),
            settings: updateOrganizationDataRetentionBodySchema.strict().parse(changes),
          },
        })
      ).data,
  },
}

async function describeSection(context: SettingsContext, section: SettingsSection) {
  const adapter = adapters[`${context.scope}/${section.id}`]
  const uiSection =
    context.scope === 'organization' &&
    section.id === 'connected-accounts' &&
    (await isKnowledgeMemberAccessAvailable({
      organizationId: organizationInput(context).organizationId,
    }))
      ? 'integrations'
      : section.uiSection
  const setupUrl = !uiSection
    ? undefined
    : context.scope === 'organization'
      ? organizationRoutes(organizationInput(context).organizationId).settingsSection(uiSection)
      : context.scope === 'workspace'
        ? `/workspace/${context.workspaceId}/settings/${uiSection}`
        : `/account/settings/${uiSection}`
  return {
    ...section,
    ...(setupUrl ? { setupUrl } : {}),
    actions: [
      'open',
      'get',
      ...(adapter?.update ? ['update'] : []),
      ...(settingsOperations[`${context.scope}/${section.id}`] ? ['execute'] : []),
    ],
    ...(section.cli
      ? {
          cliScope:
            'Workspace commands require the explicit target in organization chat. Read reference for exact options.',
        }
      : {}),
    ...(context.scope === 'organization' && section.id === 'integrations'
      ? { tool: 'search_sources' }
      : {}),
  }
}

export const settingsServerTool: BaseServerTool<MothershipSettingsInput> = {
  name: 'settings',
  inputSchema: mothershipSettingsInputSchema,
  async execute(raw, context) {
    const input = mothershipSettingsInputSchema.parse(raw)
    const target = await resolveSettingsContext(input.scope, context, input.workspaceId)
    context?.abortSignal?.throwIfAborted()
    context?.userStopSignal?.throwIfAborted()
    if (input.action === 'list')
      return {
        scope: input.scope,
        sections: await Promise.all(
          settingsSections[input.scope].map((section) => describeSection(target, section))
        ),
        permissions:
          'Listed sections are discovery, not access grants. Selected operations recheck current roles, entitlements and policies.',
      }
    const section = settingsSections[input.scope].find(
      (candidate) => candidate.id === input.section
    )
    if (!section)
      throw new OrchestrationError(
        'validation',
        'Unknown settings section; use list to discover supported sections'
      )
    const description = await describeSection(target, section)
    if (input.action === 'open') return { ...description, status: 'requires_user_setup' }
    const adapter = adapters[`${input.scope}/${input.section}`]
    const operations = settingsOperations[`${input.scope}/${input.section}`]
    if (input.action === 'execute' || input.action === 'describe') {
      const operation =
        operations && Object.hasOwn(operations, input.operation)
          ? operations[input.operation]
          : undefined
      if (!operation)
        throw new OrchestrationError(
          'validation',
          'Unknown operation for this settings section; use get to see available operations'
        )
      if (input.action === 'describe')
        return {
          scope: input.scope,
          section: input.section,
          operation: input.operation,
          inputSchema: z.toJSONSchema(operation.inputSchema, { target: 'draft-7', io: 'input' }),
        }
      return {
        scope: input.scope,
        section: input.section,
        operation: input.operation,
        result: await operation.execute(target, input.input),
      }
    }
    if (input.action === 'get')
      return {
        ...description,
        ...(adapter ? { value: await adapter.get(target) } : {}),
        ...(adapter?.schema
          ? { updateSchema: z.toJSONSchema(adapter.schema, { target: 'draft-7', io: 'input' }) }
          : {}),
        ...(operations
          ? {
              operations: Object.keys(operations),
              operationSchemas: 'Use describe with one operation name for its exact inputs.',
            }
          : {}),
      }
    if (!adapter?.update)
      throw new OrchestrationError(
        'validation',
        'This section uses the operation or setup flow returned by get'
      )
    if (adapter.schema) parseSettingsArguments(adapter.schema, input.changes)
    if (Object.keys(input.changes).length === 0)
      throw new OrchestrationError('validation', 'Provide at least one changed setting')
    return {
      scope: input.scope,
      section: input.section,
      status: 'updated',
      value: await adapter.update(target, input.changes),
    }
  },
}
