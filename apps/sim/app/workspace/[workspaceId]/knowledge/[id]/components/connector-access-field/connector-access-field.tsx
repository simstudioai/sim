'use client'

import type { ReactNode } from 'react'
import { ButtonGroup, ButtonGroupItem, ChipCombobox, ChipModalField } from '@sim/emcn'
import Link from 'next/link'
import {
  type ConnectorMemberGroupOptions,
  decodeConnectorMemberGroupOption,
  encodeConnectorMemberGroupOption,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-member-group-options'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import type { ConnectorMeta } from '@/connectors/types'

/** What the caller chose; `members` may name the option the connector crawls with. */
export interface ConnectorAccessSelection {
  accessMode: 'workspace' | 'members'
  credentialGroupId?: string
  credentialGroupOptionId?: string
}

interface ConnectorAccessFieldProps {
  workspaceId: string
  connectorConfig: ConnectorMeta
  value: ConnectorAccessSelection
  onChange: (value: ConnectorAccessSelection) => void
  /** From `useConnectorMemberGroupOptions`; shared with the modal so both agree on what is required. */
  groupOptions: ConnectorMemberGroupOptions
  /** Only an admin may put a connector into members mode. */
  canAdmin: boolean
  disabled?: boolean
  /** Whether per-member access may be chosen; false leaves only the way back to workspace access. */
  allowMembers?: boolean
  /** Rendered under the selection, for a caller that applies the change with its own control. */
  footer?: ReactNode
}

/**
 * The Access section of a connector's settings: sync as the workspace, or
 * crawl once per member so each person sees only what the source lets them
 * read. Per-member access needs nothing from the admin: a Credential Group is
 * found or created for the connector's provider, everyone in the workspace is
 * invited, and each person connects their own account. Only a workspace with
 * several matching groups is asked which one to use.
 */
export function ConnectorAccessField({
  workspaceId,
  connectorConfig,
  value,
  onChange,
  groupOptions,
  canAdmin,
  disabled = false,
  allowMembers = true,
  footer,
}: ConnectorAccessFieldProps) {
  const { features } = useWorkspaceHostContext()
  const credentialGroupsAvailable = features?.credentialGroups === true

  if (!groupOptions.supported) return null

  if (!canAdmin) {
    if (value.accessMode !== 'members') return null
    return (
      <ChipModalField type='custom' title='Access'>
        <ButtonGroup value='members' onValueChange={() => undefined}>
          <ButtonGroupItem value='workspace' disabled>
            Workspace
          </ButtonGroupItem>
          <ButtonGroupItem value='members' disabled>
            Per member
          </ButtonGroupItem>
        </ButtonGroup>
      </ChipModalField>
    )
  }

  const selectedValue =
    value.accessMode === 'members' && value.credentialGroupId && value.credentialGroupOptionId
      ? encodeConnectorMemberGroupOption(value.credentialGroupId, value.credentialGroupOptionId)
      : undefined
  const { options, needsChoice, isLoading, error } = groupOptions
  const membersHint = !credentialGroupsAvailable
    ? 'Per-member access needs Credential Groups, which are not available on this plan.'
    : !allowMembers
      ? 'Per-member access is turned off for this workspace.'
      : undefined

  return (
    <ChipModalField
      type='custom'
      title='Access'
      error={error?.message}
      hint={
        value.accessMode === 'members'
          ? 'Each member sees only the documents their own account can open. Scheduled, API, and chat runs see workspace-visible documents only.'
          : membersHint
      }
    >
      <div className='flex flex-col gap-2'>
        <ButtonGroup
          value={value.accessMode}
          onValueChange={(mode) =>
            onChange(mode === 'members' ? { accessMode: 'members' } : { accessMode: 'workspace' })
          }
        >
          <ButtonGroupItem value='workspace' disabled={disabled}>
            Workspace
          </ButtonGroupItem>
          <ButtonGroupItem
            value='members'
            disabled={disabled || !allowMembers || !credentialGroupsAvailable}
          >
            Per member
          </ButtonGroupItem>
        </ButtonGroup>

        {value.accessMode === 'members' && (
          <>
            {needsChoice && (
              <ChipCombobox
                options={options}
                value={selectedValue}
                onChange={(next) => {
                  const decoded = decodeConnectorMemberGroupOption(next)
                  if (decoded) onChange({ accessMode: 'members', ...decoded })
                }}
                placeholder='Choose which credential group members connect through'
                isLoading={isLoading}
                disabled={disabled || Boolean(error)}
              />
            )}
            <p className='text-[var(--text-muted)] text-caption leading-snug'>
              {options.length === 1
                ? `Members connect through ${options[0].label}. `
                : options.length === 0
                  ? `A credential group named ${connectorConfig.name} is created. `
                  : ''}
              Everyone in the workspace is invited by email to connect their own{' '}
              {connectorConfig.name} account as the first sync starts, and people who join later are
              invited automatically. Manage members in{' '}
              <Link
                href={`/workspace/${workspaceId}/settings/credential-groups`}
                className='text-[var(--text-primary)] underline underline-offset-2'
              >
                Settings
              </Link>
              .
            </p>
          </>
        )}

        {footer}
      </div>
    </ChipModalField>
  )
}
