'use client'

import { useState } from 'react'
import {
  Chip,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import type { CredentialGroupApiKeyOption } from '@/lib/api/contracts/credential-groups'
import type { OrganizationAccountsSettings } from '@/lib/api/contracts/organization-accounts'
import { CREDENTIAL_GROUP_API_KEY_OPTION_LIMIT } from '@/lib/credential-groups/api-key-constants'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useUpdateOrganizationAccounts } from '@/hooks/queries/organization-accounts'

interface OrganizationAccountApiKeysProps {
  organizationId: string
  group: NonNullable<OrganizationAccountsSettings['credentialGroup']>
}

type Editor = { kind: 'add' } | { kind: 'edit' | 'remove'; option: CredentialGroupApiKeyOption }
type EditorSelection = { kind: 'add' } | { kind: 'edit' | 'remove'; optionId: string }

export function OrganizationAccountApiKeys({
  organizationId,
  group,
}: OrganizationAccountApiKeysProps) {
  const [selection, setSelection] = useState<EditorSelection | null>(null)
  const selectedOption =
    selection && selection.kind !== 'add'
      ? group.apiKeyOptions.find((option) => option.id === selection.optionId)
      : undefined
  const editor: Editor | null =
    selection?.kind === 'add'
      ? selection
      : selection && selectedOption
        ? { kind: selection.kind, option: selectedOption }
        : null
  return (
    <SettingsSection
      label='API keys'
      action={
        <Chip
          disabled={group.apiKeyOptions.length >= CREDENTIAL_GROUP_API_KEY_OPTION_LIMIT}
          onClick={() => setSelection({ kind: 'add' })}
        >
          Add API key
        </Chip>
      }
    >
      <p className='mb-3 text-[var(--text-muted)] text-small'>
        Define the keys to request. Each person supplies their own value when they connect.
      </p>
      <div className={RESOURCE_LIST_STACK}>
        {group.apiKeyOptions.map((option) => (
          <SettingsResourceRow
            key={option.id}
            title={option.name}
            description={option.description ?? undefined}
            trailing={
              <RowActionsMenu
                label={`${option.name} actions`}
                actions={[
                  {
                    label: 'Edit',
                    onSelect: () => setSelection({ kind: 'edit', optionId: option.id }),
                  },
                  {
                    label: 'Remove',
                    destructive: true,
                    onSelect: () => setSelection({ kind: 'remove', optionId: option.id }),
                  },
                ]}
              />
            }
          />
        ))}
        {group.apiKeyOptions.length === 0 && (
          <SettingsEmptyState variant='inline'>No API keys requested.</SettingsEmptyState>
        )}
      </div>
      {editor && (
        <ApiKeyOptionModal
          key={editor.kind === 'add' ? 'add' : `${editor.kind}:${editor.option.id}`}
          organizationId={organizationId}
          group={group}
          editor={editor}
          onClose={() => setSelection(null)}
        />
      )}
    </SettingsSection>
  )
}

interface ApiKeyOptionModalProps extends OrganizationAccountApiKeysProps {
  editor: Editor
  onClose(): void
}

function ApiKeyOptionModal({ organizationId, group, editor, onClose }: ApiKeyOptionModalProps) {
  const option = editor.kind === 'add' ? undefined : editor.option
  const [name, setName] = useState(option?.name ?? '')
  const [description, setDescription] = useState(option?.description ?? '')
  const update = useUpdateOrganizationAccounts()
  const removing = editor.kind === 'remove'
  const title = removing
    ? `Remove ${option?.name}`
    : option
      ? 'Edit API key request'
      : 'Add API key request'
  const save = () => {
    if (update.isPending) return
    const others = group.apiKeyOptions.filter((item) => item.id !== option?.id)
    const definition = {
      ...(option ? { id: option.id } : {}),
      name,
      description: description.trim() || null,
    }
    update.mutate(
      {
        organizationId,
        groupId: group.id,
        update: {
          apiKeyOptions: removing
            ? others
            : option
              ? group.apiKeyOptions.map((item) => (item.id === option.id ? definition : item))
              : [...group.apiKeyOptions, definition],
        },
      },
      { onSuccess: onClose }
    )
  }
  return (
    <ChipModal
      open
      size='sm'
      srTitle={title}
      dismissDisabled={update.isPending}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ChipModalHeader onClose={onClose} closeDisabled={update.isPending}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {removing ? (
          <p className='px-2 text-[var(--text-error)] text-sm'>
            Remove this request and every submitted key for it? Workflows using those keys will
            fail.
          </p>
        ) : (
          <>
            <ChipModalField
              type='input'
              title='Name'
              value={name}
              onChange={setName}
              placeholder='Exa API key'
              maxLength={100}
              required
              disabled={update.isPending}
            />
            <ChipModalField
              type='textarea'
              title='Description'
              value={description}
              onChange={setDescription}
              placeholder='Tell people where to get the key and what permissions it needs.'
              maxLength={1000}
              disabled={update.isPending}
            />
          </>
        )}
        <ChipModalError>{update.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        defaultAction={removing ? 'none' : 'primary'}
        onCancel={onClose}
        cancelDisabled={update.isPending}
        primaryAction={{
          label: update.isPending ? 'Saving…' : removing ? 'Remove' : 'Save',
          variant: removing ? 'destructive' : 'primary',
          disabled: update.isPending || (!removing && !name.trim()),
          onClick: save,
        }}
      />
    </ChipModal>
  )
}
