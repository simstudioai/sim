'use client'

import { Chip, ChipLink, ChipSelect, ChipSwitch, Tooltip, toast } from '@sim/emcn'
import { ArrowLeft, Ban, Check, Hand } from '@sim/emcn/icons'
import type {
  AssistantToolPermissionsResponse,
  UpdateAssistantToolPermissionsBody,
} from '@/lib/api/contracts/assistant-actions'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import { organizationRoutes } from '@/lib/navigation/paths'
import {
  OrganizationPage,
  useOrganizationPageFilters,
} from '@/app/o/[organizationId]/components/organization-page'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useAssistantToolPermissions,
  useUpdateAssistantToolPermissions,
} from '@/hooks/queries/assistant-actions'

const POLICY_OPTIONS = [
  { value: 'allow', label: 'Allow', icon: Check },
  { value: 'ask', label: 'Ask', icon: Hand },
  { value: 'block', label: 'Block', icon: Ban },
] as const
const TOOL_GROUPS = [
  { effect: 'read', label: 'Read-only tools' },
  { effect: 'write', label: 'Write tools' },
] as const

interface AccountToolPermissionsProps {
  organizationId: string
  credentialId: string
}

export function AccountToolPermissions({
  organizationId,
  credentialId,
}: AccountToolPermissionsProps) {
  const query = useAssistantToolPermissions(organizationId, credentialId)
  const update = useUpdateAssistantToolPermissions(organizationId, credentialId)
  const { search } = useOrganizationPageFilters()
  const data = query.data
  const display = data
    ? resolveCredentialDisplay({ ...data.account, type: 'managed_oauth' })
    : undefined
  const save = (change: UpdateAssistantToolPermissionsBody['change']) => {
    if (!data || update.isPending) return
    update.mutate(
      { revision: data.revision, change },
      { onError: (error) => toast.error(error.message) }
    )
  }

  return (
    <OrganizationPage
      title='Tool permissions'
      searchMode='expanded'
      searchPlaceholder='Search tools'
      action={
        <ChipLink
          href={organizationRoutes(organizationId).integrations}
          leftIcon={ArrowLeft}
          mobileIconOnly
        >
          Integrations
        </ChipLink>
      }
    >
      {query.error ? (
        <SettingsQueryErrorState
          error={query.error}
          fallback='Could not load tool permissions'
          isRetrying={query.isFetching}
          onRetry={() => void query.refetch()}
          variant='inline'
        />
      ) : !data ? (
        <SettingsEmptyState variant='inline'>Loading tool permissions</SettingsEmptyState>
      ) : (
        <div className='flex flex-col gap-7'>
          <div className='flex flex-col gap-3'>
            <SettingsResourceRow
              flush
              title={display?.detailTitle ?? data.account.providerId}
              description={data.account.displayName}
              iconVariant='custom'
              icon={
                display?.icon ? (
                  <IntegrationTile blockType={display.blockType} icon={display.icon} />
                ) : undefined
              }
            />
            <p className='text-[var(--text-muted)] text-small'>
              Allow runs automatically. Ask pauses for your review. Block prevents use.
            </p>
            {!data.canAutoApprove && (
              <p className='text-[var(--text-muted)] text-small'>
                Your organization requires approval before tools run.
              </p>
            )}
            {!data.account.active && (
              <p className='text-[var(--text-muted)] text-small'>
                This account is disconnected or paused. Reconnect it before allowing tools
                automatically.
              </p>
            )}
          </div>
          {TOOL_GROUPS.map((group) => (
            <ToolPermissionGroup
              key={group.effect}
              {...group}
              data={data}
              search={search}
              pending={update.isPending}
              onChange={save}
            />
          ))}
          {data.tools.length === 0 && (
            <SettingsEmptyState variant='inline'>
              No Assistant tools are available for this account
            </SettingsEmptyState>
          )}
        </div>
      )}
    </OrganizationPage>
  )
}

interface ToolPermissionGroupProps {
  effect: 'read' | 'write'
  label: string
  data: AssistantToolPermissionsResponse
  search: string
  pending: boolean
  onChange: (change: UpdateAssistantToolPermissionsBody['change']) => void
}

function ToolPermissionGroup({
  effect,
  label,
  data,
  search,
  pending,
  onChange,
}: ToolPermissionGroupProps) {
  const tools = data.tools.filter((tool) => tool.effect === effect)
  const query = search.trim().toLowerCase()
  const visible = tools.filter((tool) =>
    `${tool.name} ${tool.description}`.toLowerCase().includes(query)
  )
  if (tools.length === 0) return null
  const defaultPolicy = effect === 'read' ? data.readPolicy : data.writePolicy
  const defaultLabel = POLICY_OPTIONS.find((option) => option.value === defaultPolicy)?.label
  const groupValue = tools.every((tool) => tool.policy === tools[0].policy)
    ? tools[0].policy
    : undefined
  const options = POLICY_OPTIONS.map((option) => ({
    ...option,
    disabled: option.value === 'allow' && (!data.canAutoApprove || !data.account.active),
  }))
  return (
    <SettingsSection
      label={`${label} (${tools.length})`}
      action={
        <ChipSelect
          options={options}
          value={groupValue}
          placeholder='Mixed'
          disabled={pending}
          aria-label={`${label} permission`}
          onChange={(value) => {
            const option = POLICY_OPTIONS.find((entry) => entry.value === value)
            if (option) onChange({ kind: 'group', effect, policy: option.value })
          }}
        />
      }
    >
      <div className='divide-y divide-[var(--border)]'>
        {visible.map((tool) => (
          <div
            key={tool.toolId}
            className='flex flex-col items-start gap-3 py-3 sm:flex-row sm:items-center sm:justify-between'
          >
            <div className='min-w-0 flex-1'>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <span className='text-[var(--text-body)] text-small'>{tool.name}</span>
                </Tooltip.Trigger>
                <Tooltip.Content>{tool.description}</Tooltip.Content>
              </Tooltip.Root>
            </div>
            <div className='flex max-w-full shrink-0 flex-wrap items-center gap-2'>
              {!tool.inherited && (
                <Chip
                  aria-label={`Reset ${tool.name} to ${defaultLabel}`}
                  disabled={pending}
                  onClick={() => onChange({ kind: 'tool', toolId: tool.toolId, policy: null })}
                >
                  Reset to {defaultLabel}
                </Chip>
              )}
              <ChipSwitch
                options={options}
                value={tool.policy}
                disabled={pending}
                aria-label={`${tool.name} permission`}
                onChange={(policy) => onChange({ kind: 'tool', toolId: tool.toolId, policy })}
              />
            </div>
          </div>
        ))}
      </div>
      {!visible.length && (
        <SettingsEmptyState variant='inline'>No matching tools</SettingsEmptyState>
      )}
    </SettingsSection>
  )
}
