'use client'

import { useState } from 'react'
import {
  Chip,
  ChipConfirmModal,
  ChipCopyInput,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  ChipTag,
  Expandable,
  ExpandableContent,
  Label,
  Switch,
  toast,
} from '@sim/emcn'
import { Key, X } from '@sim/emcn/icons'
import { getErrorMessage } from '@sim/utils/errors'
import type {
  ScimActivityEntry,
  ScimConnectionView,
  ScimCredentialView,
  ScimGroupMappingBody,
  ScimGroupMappingView,
} from '@/lib/api/contracts/organization-scim'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  useOrganizationWorkspaces,
  usePermissionGroups,
} from '@/ee/access-control/hooks/permission-groups'
import { SettingRow } from '@/ee/components/setting-row'
import {
  CREDENTIAL_EXPIRY_OPTIONS,
  type CredentialExpiry,
  type MappingTargetKind,
  PERMISSION_OPTIONS,
  SETTING_TOGGLES,
  TARGET_KIND_OPTIONS,
  type WorkspacePermission,
} from '@/ee/scim/components/options'
import {
  useConfigureScimConnection,
  useDeleteScimGroupMapping,
  useIssueScimCredential,
  useReconcileScimConnection,
  useRevokeScimCredential,
  useScimActivity,
  useScimConnection,
  useScimGroupMappings,
  useUpsertScimGroupMapping,
} from '@/ee/scim/hooks/scim'

interface ScimSectionProps {
  organizationId: string
  active: boolean
  onOpenDomains: () => void
}

const RELATIVE_TIME = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** Renders "3 minutes ago" for the activity list and credential rows. */
function formatRelative(iso: string | null): string {
  if (!iso) return 'never'
  const deltaMs = new Date(iso).getTime() - Date.now()
  const minutes = Math.round(deltaMs / 60_000)
  if (Math.abs(minutes) < 60) return RELATIVE_TIME.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 48) return RELATIVE_TIME.format(hours, 'hour')
  return RELATIVE_TIME.format(Math.round(hours / 24), 'day')
}

function describeMapping(
  mapping: ScimGroupMappingView,
  names: { permissionGroups: Map<string, string>; workspaces: Map<string, string> }
): string {
  switch (mapping.targetKind) {
    case 'permission_group':
      return names.permissionGroups.get(mapping.permissionGroupId ?? '') ?? 'Permission group'
    case 'workspace': {
      const name = names.workspaces.get(mapping.workspaceId ?? '') ?? 'Workspace'
      const level = PERMISSION_OPTIONS.find((o) => o.value === mapping.permissionType)?.label
      return level ? `${name} · ${level}` : name
    }
    case 'org_role':
      return 'Organization admin'
  }
}

interface CredentialRowProps {
  credential: ScimCredentialView
  onRevoke: (credential: ScimCredentialView) => void
}

function CredentialRow({ credential, onRevoke }: CredentialRowProps) {
  const expiry = credential.expiresAt
    ? `expires ${formatRelative(credential.expiresAt)}`
    : 'no expiry'
  return (
    <SettingsResourceRow
      title={`${credential.tokenPrefix}…`}
      description={`Last used ${formatRelative(credential.lastUsedAt)} · ${expiry}`}
      trailing={
        <RowActionsMenu
          label={`${credential.tokenPrefix} actions`}
          actions={[{ label: 'Revoke', onSelect: () => onRevoke(credential), destructive: true }]}
        />
      }
    />
  )
}

interface AddMappingProps {
  organizationId: string
  groupId: string
  permissionGroups: Array<{ id: string; name: string }>
  workspaces: Array<{ id: string; name: string }>
}

function AddMapping({ organizationId, groupId, permissionGroups, workspaces }: AddMappingProps) {
  const upsertMapping = useUpsertScimGroupMapping()
  const [targetKind, setTargetKind] = useState<MappingTargetKind>('permission_group')
  const [targetId, setTargetId] = useState('')
  const [permission, setPermission] = useState<WorkspacePermission>('read')

  function buildBody(): ScimGroupMappingBody | null {
    switch (targetKind) {
      case 'permission_group':
        return targetId ? { groupId, targetKind, permissionGroupId: targetId } : null
      case 'workspace':
        return targetId
          ? { groupId, targetKind, workspaceId: targetId, permissionType: permission }
          : null
      case 'org_role':
        return { groupId, targetKind, role: 'admin' }
    }
  }

  const body = buildBody()

  async function handleAdd() {
    if (!body) return
    try {
      const result = await upsertMapping.mutateAsync({ organizationId, body })
      setTargetId('')
      toast.success(
        result.reconciledUsers === 0
          ? 'Mapping added'
          : `Mapping added and applied to ${result.reconciledUsers} member${result.reconciledUsers === 1 ? '' : 's'}`
      )
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to add mapping'))
    }
  }

  const targetOptions = targetKind === 'permission_group' ? permissionGroups : workspaces

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <ChipSelect
        aria-label='Mapping target type'
        align='start'
        value={targetKind}
        onChange={(next) => {
          setTargetKind(next as MappingTargetKind)
          setTargetId('')
        }}
        options={[...TARGET_KIND_OPTIONS]}
      />
      {targetKind !== 'org_role' && (
        <ChipSelect
          aria-label={targetKind === 'workspace' ? 'Workspace' : 'Permission group'}
          align='start'
          searchable
          placeholder={targetKind === 'workspace' ? 'Choose a workspace' : 'Choose a group'}
          value={targetId}
          onChange={setTargetId}
          options={targetOptions.map((target) => ({ value: target.id, label: target.name }))}
        />
      )}
      {targetKind === 'workspace' && (
        <ChipSelect
          aria-label='Workspace permission'
          align='start'
          value={permission}
          onChange={(next) => setPermission(next as WorkspacePermission)}
          options={[...PERMISSION_OPTIONS]}
        />
      )}
      <Chip variant='primary' onClick={handleAdd} disabled={!body || upsertMapping.isPending}>
        {upsertMapping.isPending ? 'Adding...' : 'Add mapping'}
      </Chip>
    </div>
  )
}

interface GroupMappingsProps {
  organizationId: string
  active: boolean
}

function GroupMappings({ organizationId, active }: GroupMappingsProps) {
  const {
    data: groups,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useScimGroupMappings(organizationId, active)
  const { data: allPermissionGroups = [] } = usePermissionGroups(organizationId, active)
  /** The default group governs by having no members, so it cannot be a membership target. */
  const permissionGroups = allPermissionGroups.filter((group) => !group.isDefault)
  const { data: workspaces = [] } = useOrganizationWorkspaces(organizationId, active)
  const deleteMapping = useDeleteScimGroupMapping()

  const names = {
    permissionGroups: new Map(permissionGroups.map((group) => [group.id, group.name])),
    workspaces: new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
  }

  async function handleRemove(mapping: ScimGroupMappingView) {
    try {
      await deleteMapping.mutateAsync({ organizationId, mappingId: mapping.id })
      toast.success('Mapping removed')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to remove mapping'))
    }
  }

  if (isLoading) {
    return <SettingsEmptyState variant='inline'>Loading groups...</SettingsEmptyState>
  }
  if (groups === undefined && isError) {
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Failed to load directory groups'
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        variant='inline'
      />
    )
  }
  if (!groups || groups.length === 0) {
    return (
      <SettingsEmptyState variant='inline'>
        No groups yet. Push a group from your identity provider and it appears here.
      </SettingsEmptyState>
    )
  }

  return (
    <div className='flex flex-col gap-5'>
      {groups.map((group) => (
        <div key={group.id} className='flex flex-col gap-3'>
          <SettingsResourceRow
            title={group.displayName}
            description={`${group.memberCount} member${group.memberCount === 1 ? '' : 's'}`}
          />
          <div className='flex flex-col gap-3'>
            {group.mappings.length > 0 && (
              <div className='flex flex-wrap gap-1.5'>
                {group.mappings.map((mapping) => (
                  <ChipTag
                    key={mapping.id}
                    variant='gray'
                    rightIcon={X}
                    rightIconLabel='Remove mapping'
                    rightIconDisabled={deleteMapping.isPending}
                    onRightIconClick={() => void handleRemove(mapping)}
                  >
                    {describeMapping(mapping, names)}
                  </ChipTag>
                ))}
              </div>
            )}
            <AddMapping
              organizationId={organizationId}
              groupId={group.id}
              permissionGroups={permissionGroups}
              workspaces={workspaces}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

interface ActivityListProps {
  organizationId: string
  active: boolean
}

function ActivityList({ organizationId, active }: ActivityListProps) {
  const {
    data: entries,
    isLoading,
    isError,
    error,
    isFetching,
    refetch,
  } = useScimActivity(organizationId, active)

  if (isLoading) {
    return <SettingsEmptyState variant='inline'>Loading activity...</SettingsEmptyState>
  }
  if (entries === undefined && isError) {
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Failed to load directory activity'
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        variant='inline'
      />
    )
  }
  if (!entries || entries.length === 0) {
    return <SettingsEmptyState variant='inline'>No requests yet.</SettingsEmptyState>
  }

  return (
    <div className='flex flex-col gap-2'>
      {entries.map((entry: ScimActivityEntry) => {
        const failed = entry.status >= 400
        return (
          <div key={entry.id} className='flex flex-col gap-0.5 text-small'>
            <div className='flex items-center gap-2'>
              <ChipTag variant={failed ? 'gray' : 'mono'} invalid={failed}>
                {entry.status}
              </ChipTag>
              <span className='truncate text-[var(--text-body)]'>
                {entry.method} {entry.path}
              </span>
              <span className='ml-auto shrink-0 text-[var(--text-muted)]'>
                {formatRelative(entry.createdAt)}
              </span>
            </div>
            {failed && entry.detail && (
              <p className='pl-1 text-[var(--text-muted)]'>
                {entry.scimType ? `${entry.scimType}: ` : ''}
                {entry.detail}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

interface ConnectionDetailsProps {
  organizationId: string
  active: boolean
  connection: ScimConnectionView
}

function ConnectionDetails({ organizationId, connection, active }: ConnectionDetailsProps) {
  const configure = useConfigureScimConnection()
  const issueCredential = useIssueScimCredential()
  const revokeCredential = useRevokeScimCredential()
  const reconcile = useReconcileScimConnection()

  const [showRules, setShowRules] = useState(false)
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null)
  const [credentialExpiry, setCredentialExpiry] = useState<CredentialExpiry>('never')
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null)
  const pendingRevoke =
    connection.credentials.find((credential) => credential.id === pendingRevokeId) ?? null

  async function handleToggleSetting(key: (typeof SETTING_TOGGLES)[number]['key'], value: boolean) {
    try {
      /** Only the changed key is sent; the server merges it, so a concurrent edit elsewhere is not reverted. */
      await configure.mutateAsync({ organizationId, settings: { [key]: value } })
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update setting'))
    }
  }

  async function handleIssue() {
    try {
      const result = await issueCredential.mutateAsync({
        organizationId,
        ...(credentialExpiry === 'never' ? {} : { expiresInDays: Number(credentialExpiry) }),
      })
      setIssuedSecret(result.secret)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to issue token'))
    }
  }

  async function handleConfirmRevoke() {
    if (!pendingRevoke) return
    try {
      await revokeCredential.mutateAsync({ organizationId, credentialId: pendingRevoke.id })
      setPendingRevokeId(null)
      toast.success('Token revoked')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to revoke token'))
    }
  }

  async function handleReconcile() {
    try {
      const report = await reconcile.mutateAsync(organizationId)
      const corrections = report.grantsAdded + report.grantsRemoved
      toast.success(
        corrections === 0
          ? `Checked ${report.reconciledUsers} members; nothing to correct`
          : `Checked ${report.reconciledUsers} members; corrected ${corrections} grant${corrections === 1 ? '' : 's'}`
      )
    } catch (error) {
      toast.error(getErrorMessage(error, 'Reconciliation failed'))
    }
  }

  return (
    <>
      <SettingsSection label='Connection'>
        <div className='flex flex-col gap-4.5'>
          <SettingRow
            label='Base URL'
            description='Enter this as the tenant or connector URL in your identity provider.'
            htmlFor='scim-base-url'
          >
            <ChipCopyInput
              id='scim-base-url'
              value={connection.baseUrl}
              copyLabel='Copy base URL'
            />
          </SettingRow>

          <SettingRow label='Status'>
            <p className='text-[var(--text-muted)] text-small'>
              {connection.userCount} provisioned member{connection.userCount === 1 ? '' : 's'},{' '}
              {connection.groupCount} group{connection.groupCount === 1 ? '' : 's'}. Last request{' '}
              {formatRelative(connection.lastRequestAt)}; last reconciled{' '}
              {formatRelative(connection.reconciledAt)}.
            </p>
          </SettingRow>
        </div>
      </SettingsSection>

      <SettingsSection label='Tokens'>
        <SettingRow
          label='Access tokens'
          description='Shown once. Keep up to two active tokens for rotation.'
        >
          <div className='flex flex-col gap-3'>
            {connection.credentials.length === 0 ? (
              <SettingsEmptyState variant='inline'>No tokens yet.</SettingsEmptyState>
            ) : (
              <div className={RESOURCE_LIST_STACK}>
                {connection.credentials.map((credential) => (
                  <CredentialRow
                    key={credential.id}
                    credential={credential}
                    onRevoke={(credential) => setPendingRevokeId(credential.id)}
                  />
                ))}
              </div>
            )}
            <div className='flex flex-wrap items-center gap-2'>
              <ChipSelect
                aria-label='Token expiry'
                align='start'
                value={credentialExpiry}
                onChange={(next) => setCredentialExpiry(next as CredentialExpiry)}
                options={[...CREDENTIAL_EXPIRY_OPTIONS]}
              />
              <Chip
                variant='primary'
                onClick={handleIssue}
                disabled={issueCredential.isPending || connection.credentials.length >= 2}
              >
                {issueCredential.isPending ? 'Issuing...' : 'Issue token'}
              </Chip>
            </div>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        label='Provisioning rules'
        action={
          <Chip
            aria-expanded={showRules}
            aria-controls='scim-rules'
            onClick={() => setShowRules(!showRules)}
          >
            {showRules ? 'Hide rules' : 'Manage rules'}
          </Chip>
        }
      >
        <p className='text-[var(--text-muted)] text-caption'>
          Control managed membership, first sign-in, and automatic group matching.
        </p>
        <Expandable expanded={showRules}>
          <ExpandableContent id='scim-rules'>
            <div className='flex flex-col gap-4.5 pt-4'>
              {SETTING_TOGGLES.map((toggle) => (
                <div key={toggle.key} className='flex items-center justify-between gap-4'>
                  <div className='flex flex-col gap-1'>
                    <Label htmlFor={`scim-${toggle.key}`}>{toggle.label}</Label>
                    <p className='text-[var(--text-muted)] text-caption'>{toggle.description}</p>
                  </div>
                  <Switch
                    id={`scim-${toggle.key}`}
                    checked={connection.settings[toggle.key] ?? false}
                    onCheckedChange={(checked) => void handleToggleSetting(toggle.key, checked)}
                    disabled={configure.isPending}
                  />
                </div>
              ))}
            </div>
          </ExpandableContent>
        </Expandable>
      </SettingsSection>

      <SettingsSection label='Group mappings'>
        <SettingRow
          label='Directory groups'
          description='Map directory groups to permission groups, workspaces, or the organization admin role.'
        >
          <GroupMappings organizationId={organizationId} active={active} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection label='Activity'>
        <SettingRow
          label='Recent requests'
          description='Requests from your identity provider, including errors.'
        >
          <div className='flex flex-col gap-3'>
            <ActivityList organizationId={organizationId} active={active} />
            <div>
              <Chip onClick={handleReconcile} disabled={reconcile.isPending}>
                {reconcile.isPending ? 'Reconciling...' : 'Reconcile now'}
              </Chip>
            </div>
          </div>
        </SettingRow>
      </SettingsSection>

      <ChipModal
        open={active && issuedSecret !== null}
        onOpenChange={(open) => !open && setIssuedSecret(null)}
      >
        <ChipModalHeader icon={Key} onClose={() => setIssuedSecret(null)}>
          Credential issued
        </ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='copy'
            title='Token'
            value={issuedSecret ?? ''}
            copyLabel='Copy token'
            hint='Copy it into your identity provider now. Sim stores only a digest and cannot show it again.'
          />
        </ChipModalBody>
        <ChipModalFooter
          onCancel={() => setIssuedSecret(null)}
          primaryAction={{ label: 'Done', onClick: () => setIssuedSecret(null) }}
        />
      </ChipModal>

      <ChipConfirmModal
        open={active && pendingRevoke !== null}
        onOpenChange={(open) => !open && setPendingRevokeId(null)}
        title='Revoke token'
        text={[
          'Revoke ',
          { text: pendingRevoke?.tokenPrefix ?? '', bold: true },
          '? Your identity provider stops syncing the moment it next uses this token. Issue a new token first if you are rotating.',
        ]}
        confirm={{
          label: 'Revoke',
          onClick: handleConfirmRevoke,
          pending: revokeCredential.isPending,
          pendingLabel: 'Revoking...',
        }}
      />
    </>
  )
}

/**
 * Manages the SCIM connection in the Provisioning tab of organization sign-in settings.
 */
export function ScimSection({ organizationId, onOpenDomains, active }: ScimSectionProps) {
  const { features } = useDeploymentShape()
  /** The deployment flag also allows activation to wait until older app instances are drained. */
  const available = features.scim
  const { data, isLoading, isError, error, isFetching, refetch } = useScimConnection(
    organizationId,
    available && active
  )
  const configure = useConfigureScimConnection()

  if (!available) return null

  if (data === undefined && isError) {
    return (
      <SettingsSection label='Directory provisioning'>
        <SettingsQueryErrorState
          error={error}
          fallback='Failed to load directory provisioning settings'
          isRetrying={isFetching}
          onRetry={() => void refetch()}
          variant='inline'
        />
      </SettingsSection>
    )
  }

  const connection = data?.connection ?? null
  const enabled = connection?.status === 'active'

  async function handleToggleEnabled(next: boolean) {
    try {
      await configure.mutateAsync({ organizationId, status: next ? 'active' : 'disabled' })
      toast.success(next ? 'Directory provisioning enabled' : 'Directory provisioning disabled')
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to update directory provisioning'))
    }
  }

  return (
    <div className='flex flex-col gap-7'>
      <SettingsSection label='Directory provisioning'>
        <div className='flex flex-col gap-4.5'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex flex-col gap-1'>
              <Label htmlFor='scim-enabled'>Enable directory provisioning</Label>
              <p className='text-[var(--text-muted)] text-caption'>
                Create, update, and deactivate members from your identity provider with SCIM 2.0.
              </p>
            </div>
            <Switch
              id='scim-enabled'
              checked={enabled}
              onCheckedChange={(checked) => void handleToggleEnabled(checked)}
              disabled={isLoading || configure.isPending}
            />
          </div>

          {!enabled && (
            <div className='flex flex-wrap items-center justify-between gap-2'>
              <p className='text-[var(--text-muted)] text-caption'>
                Verify an email domain, then enable provisioning to connect your directory.
              </p>
              <Chip onClick={onOpenDomains}>Manage domains</Chip>
            </div>
          )}
        </div>
      </SettingsSection>
      {connection && enabled && (
        <ConnectionDetails
          organizationId={organizationId}
          connection={connection}
          active={active}
        />
      )}
    </div>
  )
}
