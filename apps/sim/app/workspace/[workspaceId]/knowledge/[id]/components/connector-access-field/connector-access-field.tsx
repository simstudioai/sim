'use client'

import type { ReactNode } from 'react'
import { ButtonGroup, ButtonGroupItem, ChipCombobox, ChipModalField } from '@sim/emcn'
import type { ConnectorAccessMode } from '@/lib/api/contracts/knowledge/connectors'
import { isConnectorAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  type ConnectorMemberGroupOptions,
  decodeConnectorMemberGroupOption,
  encodeConnectorMemberGroupOption,
} from '@/app/workspace/[workspaceId]/knowledge/[id]/hooks/use-connector-member-group-options'
import type { ConnectorMeta } from '@/connectors/types'

/** What the caller chose; `members` may name the option the connector crawls with. */
export interface ConnectorAccessSelection {
  accessMode: ConnectorAccessMode
  credentialGroupId?: string
  credentialGroupOptionId?: string
}

interface ConnectorAccessFieldProps {
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
  /**
   * Whether the connector already syncs per member, so any matching group may
   * be chosen, not only when several make the choice necessary.
   */
  canRebind?: boolean
  /** Rendered under the selection, for a caller that applies the change with its own control. */
  footer?: ReactNode
}

/**
 * Each mode decides who can read the indexed documents, which the three labels
 * cannot say on their own — and getting it wrong is the kind of mistake that is
 * only noticed once the wrong person finds a document.
 */
function accessHint(input: {
  mode: ConnectorAccessMode
  connectorConfig: ConnectorMeta
  allowMembers: boolean
}): string | undefined {
  if (input.mode === 'members') {
    return `Everyone in the workspace is invited by email to connect their ${input.connectorConfig.name} account when the first sync starts. Each member sees only the documents their own account can open; scheduled, API, and chat runs see workspace-visible documents only.`
  }
  if (input.mode === 'admin') {
    return `Indexed once as an administrator, keeping each document's own permissions. People see only what ${input.connectorConfig.name} already lets them open; scheduled, API, and chat runs see workspace-visible documents only.`
  }
  return input.allowMembers ? undefined : 'Per-member access is turned off for this workspace.'
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
  connectorConfig,
  value,
  onChange,
  groupOptions,
  canAdmin,
  disabled = false,
  allowMembers = true,
  canRebind = false,
  footer,
}: ConnectorAccessFieldProps) {
  if (!groupOptions.supported) return null

  const allowAdmin = Boolean(connectorConfig.mirrorsSourceAcls)

  if (!canAdmin) {
    if (value.accessMode === 'workspace') return null
    return (
      <ChipModalField type='custom' title='Access'>
        <ButtonGroup value={value.accessMode}>
          <ButtonGroupItem value='workspace' disabled>
            Workspace
          </ButtonGroupItem>
          <ButtonGroupItem value='members' disabled>
            Per member
          </ButtonGroupItem>
          {allowAdmin ? (
            <ButtonGroupItem value='admin' disabled>
              Mirror source
            </ButtonGroupItem>
          ) : null}
        </ButtonGroup>
      </ChipModalField>
    )
  }

  const selectedValue =
    value.accessMode === 'members' && value.credentialGroupId && value.credentialGroupOptionId
      ? encodeConnectorMemberGroupOption(value.credentialGroupId, value.credentialGroupOptionId)
      : undefined
  const { options, needsChoice, isLoading, error } = groupOptions
  const showPicker = needsChoice || (canRebind && options.length > 0)

  return (
    <ChipModalField
      type='custom'
      title='Access'
      error={error?.message}
      hint={accessHint({ mode: value.accessMode, connectorConfig, allowMembers })}
    >
      <div className='flex flex-col gap-2'>
        <ButtonGroup
          value={value.accessMode}
          onValueChange={(mode) => {
            if (isConnectorAccessMode(mode)) onChange({ accessMode: mode })
          }}
        >
          <ButtonGroupItem value='workspace' disabled={disabled}>
            Workspace
          </ButtonGroupItem>
          <ButtonGroupItem value='members' disabled={disabled || !allowMembers}>
            Per member
          </ButtonGroupItem>
          {allowAdmin ? (
            <ButtonGroupItem value='admin' disabled={disabled}>
              Mirror source
            </ButtonGroupItem>
          ) : null}
        </ButtonGroup>

        {value.accessMode === 'members' && showPicker && (
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

        {footer}
      </div>
    </ChipModalField>
  )
}
