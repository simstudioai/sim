'use client'

import type { ReactNode } from 'react'
import { Button } from '@sim/emcn/button'
import { FieldFrame } from '@sim/emcn/field'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { LoadingRows } from '@sim/emcn/status/query-boundary'
import { Tooltip } from '@sim/emcn/tooltip'
import { getErrorMessage } from '@sim/utils/errors'
import Link from 'next/link'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import type { ResourceScope } from '@/lib/core/resource-scope'
import { slackSearchSetupHref } from '@/lib/sim-search/setup-navigation'
import type { ConnectorMeta } from '@/connectors/types'
import { useConnectorAccessField } from '@/hooks/kb/connectors/use-connector-access-field'
import { Muted } from '@/platform/embedded/app/(shell)/_components/section-parts/section-parts'

interface ConnectorAccessProps {
  scope: ResourceScope
  connectorConfig: ConnectorMeta
  value: { accessMode: ConnectorAccessMode }
  onChange: (value: { accessMode: ConnectorAccessMode }) => void
  canAdmin: boolean
  disabled?: boolean
  lockAccessMode?: boolean
  isAvailabilityReady?: boolean
  allowMembers?: boolean
  allowAdmin?: boolean
  allowWorkspace?: boolean
  footer?: ReactNode
  searchSetupSource?: 'slack'
  slackSetupOnly?: boolean
  onSetupNavigate?: () => void
}

/** Chooses how a source connects while preserving its document permissions. */
export function ConnectorAccess({
  scope: explicitScope,
  connectorConfig,
  value,
  onChange,
  canAdmin,
  disabled = false,
  lockAccessMode = false,
  isAvailabilityReady = true,
  allowMembers = true,
  allowAdmin = false,
  allowWorkspace = true,
  footer,
  searchSetupSource,
  slackSetupOnly = false,
  onSetupNavigate,
}: ConnectorAccessProps) {
  const access = useConnectorAccessField({
    scope: explicitScope,
    connectorConfig,
    value,
    canAdmin,
    lockAccessMode,
    allowMembers,
    allowAdmin,
    allowWorkspace,
  })
  const { accountsQuery, currentMode, modes, scope, showSlackSetup, visibleModes } = access
  if (access.hidden) return null
  if (access.singleMode) return canAdmin && footer ? <div>{footer}</div> : null
  const hint =
    canAdmin && isAvailabilityReady && !currentMode?.allowed
      ? `This connection method is not available in this ${scope.kind}.`
      : value.accessMode === 'workspace'
        ? 'Everyone in this workspace can search these documents.'
        : undefined
  return (
    <FieldFrame
      label={slackSetupOnly ? 'Slack app' : allowWorkspace ? 'Connection method' : 'Sync using'}
      error={canAdmin && !showSlackSetup ? accountsQuery.error?.message : undefined}
      hint={hint}
    >
      {slackSetupOnly ? null : lockAccessMode ? (
        <div>
          <Tooltip label='Add a new connection to change the sync method.'>
            <span>
              <StatusTag label={currentMode?.label ?? 'Unavailable'} />
            </span>
          </Tooltip>
        </div>
      ) : access.showModeSelector ? (
        <SegmentedControl
          label='Connection method'
          value={value.accessMode}
          options={visibleModes.map((entry) => ({
            value: entry.mode,
            label: entry.label,
            disabled: !entry.allowed,
          }))}
          onSelect={(mode) => {
            const selection = modes.find((entry) => entry.mode === mode && entry.allowed)
            if (!disabled && selection) onChange({ accessMode: selection.mode })
          }}
        />
      ) : (
        <Muted>{modes.find((entry) => entry.mode === value.accessMode)?.label ?? ''}</Muted>
      )}
      {/* Decides a setup link beside the access choice, not the content of a read. */}
      {showSlackSetup &&
        (accountsQuery.isError ? (
          <FailureNotice
            message={getErrorMessage(accountsQuery.error, 'Could not check Slack setup')}
            retrying={accountsQuery.isFetching}
            onRetry={() => void accountsQuery.refetch()}
          />
        ) : accountsQuery.isPending ? (
          <LoadingRows label='Checking Slack setup…' rows={1} />
        ) : accountsQuery.isSuccess && !access.configured && scope.kind === 'organization' ? (
          <div>
            <Button
              size='compact'
              render={
                <Link
                  href={slackSearchSetupHref(scope.organizationId, searchSetupSource ?? 'search')}
                  onClick={onSetupNavigate}
                />
              }
            >
              Set up Slack
            </Button>
          </div>
        ) : null)}
      {canAdmin && footer}
    </FieldFrame>
  )
}
