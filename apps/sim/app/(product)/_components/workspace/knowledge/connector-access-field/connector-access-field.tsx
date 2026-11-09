'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { SelectField } from '@sim/emcn/field'
import { DetailsField } from '@sim/emcn/field/details-field'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import Link from 'next/link'
import styles from '@/app/(product)/_components/workspace/knowledge/connector-access-field/connector-access-field.module.css'
import {
  type ConnectorAccessMode,
  type ConnectorMeta,
  useConnectorAccessField,
} from '@/platform/lib/data/knowledge/connectors'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { useSurfaceScope } from '@/platform/lib/surface-scope'

const CONNECTED_MEMBERS = '__connected_members__'

/** A picker entry that starts a flow, such as connecting an account, instead of choosing a value. */
export interface CredentialPickerAction {
  value: string
  label: string
  onSelect: () => void
}

interface ContentCredentialFieldProps {
  credentialId: string | null
  onChange: (credentialId: string | null) => void
  options: readonly { value: string; label: string }[]
  /** Entries after the accounts, such as connecting another account or adding a service account. */
  actions?: readonly CredentialPickerAction[]
  disabled?: boolean
}

/** A dedicated source account supplies content; member accounts then supply visibility only. */
export function ContentCredentialField({
  credentialId,
  onChange,
  options,
  actions = [],
  disabled,
}: ContentCredentialFieldProps) {
  return (
    <SelectField
      label='Sync documents with'
      value={credentialId ?? CONNECTED_MEMBERS}
      onValueChange={(value) => {
        const action = actions.find((entry) => entry.value === value)
        if (action) action.onSelect()
        else onChange(value === CONNECTED_MEMBERS ? null : value)
      }}
      options={[
        { value: CONNECTED_MEMBERS, label: 'Connected members' },
        ...options,
        ...actions.map(({ value, label }) => ({ value, label })),
      ]}
      disabled={disabled}
    />
  )
}

interface ConnectorAccessFieldProps {
  workspaceId: string
  connectorConfig: ConnectorMeta
  accessMode: ConnectorAccessMode
  onChange: (accessMode: ConnectorAccessMode) => void
  /** Only an administrator may move a connector out of workspace mode. */
  canAdmin: boolean
  disabled?: boolean
  /** Existing Search sources keep the method chosen at setup. */
  locked?: boolean
  availabilityReady?: boolean
  allowMembers: boolean
  allowAdmin: boolean
  allowWorkspace: boolean
  /** Beneath the choice, for a caller that applies a change with its own control. */
  footer?: ReactNode
  /** Saves the form before Set up Slack leaves the page. */
  onSetupNavigate?: () => void
}

/**
 * How a source connects: the whole workspace, each member's own account, or an administrator or
 * service account that mirrors the source's permissions. Methods the source or workspace does not
 * offer stay out of the choice, though a retired current method stays visible for recovery.
 */
export function ConnectorAccessField({
  workspaceId,
  connectorConfig,
  accessMode,
  onChange,
  canAdmin,
  disabled = false,
  locked = false,
  availabilityReady = true,
  allowMembers,
  allowAdmin,
  allowWorkspace,
  footer,
  onSetupNavigate,
}: ConnectorAccessFieldProps) {
  const surface = useSurfaceScope()
  const field = useConnectorAccessField({
    workspaceId,
    connectorConfig,
    value: { accessMode },
    canAdmin,
    lockAccessMode: locked,
    allowMembers,
    allowAdmin,
    allowWorkspace,
  })
  if (field.hidden) return null
  if (field.singleMode)
    return canAdmin && footer ? <div className={styles.footer}>{footer}</div> : null
  const label = allowWorkspace ? 'Connection method' : 'Sync using'
  const notice =
    canAdmin && availabilityReady && !field.currentMode?.allowed
      ? 'This connection method is not available in this workspace.'
      : accessMode === 'workspace'
        ? 'Everyone in this workspace can search these documents.'
        : undefined
  /** The organization's Slack app, where the credential group members connect through lives. */
  const slackSetupHref = surfaceHref(surface, '/settings/search-slack')

  return (
    <DetailsField label={label}>
      <div className={styles.field}>
        {locked ? (
          <SelectField
            label={label}
            value={accessMode}
            options={field.visibleModes.map(({ mode, label: text }) => ({
              value: mode,
              label: text,
            }))}
            disabled
            disabledReason='Add a new connection to change the sync method.'
          />
        ) : field.showModeSelector ? (
          <SegmentedControl
            label={label}
            value={accessMode}
            holdOnReselect
            options={field.visibleModes.map((entry) => ({
              value: entry.mode,
              label: entry.label,
              disabled: disabled || !entry.allowed,
            }))}
            onSelect={(mode) => {
              const selection = field.modes.find((entry) => entry.mode === mode && entry.allowed)
              if (!disabled && selection) onChange(selection.mode)
            }}
          />
        ) : (
          <span data-type='T060'>
            {field.modes.find((entry) => entry.mode === accessMode)?.label}
          </span>
        )}
        {notice && (
          <span className={styles.hint} data-type='T052'>
            {notice}
          </span>
        )}
        {field.showSlackSetup &&
          (field.accountsQuery.isError ? (
            <FailureNotice
              message='Could not check Slack setup.'
              retrying={field.accountsQuery.isFetching}
              onRetry={() => void field.accountsQuery.refetch()}
            />
          ) : field.accountsQuery.isSuccess && !field.configured ? (
            <InlineNotice
              message='Members connect through your workspace’s Slack app. Set it up first.'
              action={
                <Button
                  variant='secondary'
                  size='compact'
                  render={<Link href={slackSetupHref} onClick={onSetupNavigate} />}
                >
                  Set up Slack
                </Button>
              }
            />
          ) : null)}
        {canAdmin && footer}
      </div>
    </DetailsField>
  )
}
