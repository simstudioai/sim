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
import { Key } from '@sim/emcn/icons'
import type { CredentialGroupApiKeyOption } from '@/lib/api/contracts/credential-groups'
import {
  CREDENTIAL_GROUP_API_KEY_MAX_LENGTH,
  CREDENTIAL_GROUP_API_KEY_MIN_LENGTH,
} from '@/lib/credential-groups/api-key-constants'
import { RowActionsMenu } from '@/app/workspace/[workspaceId]/settings/components/row-actions-menu'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import {
  useDisconnectPersonalOrganizationAccount,
  useSaveOrganizationAccountApiKey,
} from '@/hooks/queries/organization-accounts'

interface OrganizationApiKeyIntegrationProps {
  organizationId: string
  option: CredentialGroupApiKeyOption
  credentialId?: string
  available: boolean
}

/** A requested personal key appears alongside the organization's other integrations. */
export function OrganizationApiKeyIntegration({
  organizationId,
  option,
  credentialId,
  available,
}: OrganizationApiKeyIntegrationProps) {
  const [modalOpen, setModalOpen] = useState(false)
  const disconnect = useDisconnectPersonalOrganizationAccount(organizationId)
  return (
    <>
      <SettingsResourceRow
        icon={<Key />}
        title={option.name}
        description={credentialId ? 'Connected' : available ? 'Not connected' : 'Unavailable'}
        trailing={
          <div className='flex items-center gap-2'>
            {credentialId && (
              <RowActionsMenu
                label={`${option.name} integration actions`}
                actions={[
                  {
                    label: 'Disconnect',
                    destructive: true,
                    disabled: disconnect.isPending,
                    onSelect: () => disconnect.mutate(credentialId),
                  },
                ]}
              />
            )}
            {available && (
              <Chip
                variant='primary'
                disabled={disconnect.isPending}
                onClick={() => setModalOpen(true)}
              >
                {credentialId ? 'Replace' : 'Connect'}
              </Chip>
            )}
          </div>
        }
      />
      {disconnect.error && (
        <p role='alert' className='px-4 text-[var(--text-error)] text-caption'>
          {disconnect.error.message}
        </p>
      )}
      {modalOpen && (
        <ConnectApiKeyModal
          key={option.id}
          organizationId={organizationId}
          option={option}
          replacing={Boolean(credentialId)}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  )
}

interface ConnectApiKeyModalProps {
  organizationId: string
  option: CredentialGroupApiKeyOption
  replacing: boolean
  onClose(): void
}

function ConnectApiKeyModal({
  organizationId,
  option,
  replacing,
  onClose,
}: ConnectApiKeyModalProps) {
  const [value, setValue] = useState('')
  const save = useSaveOrganizationAccountApiKey(organizationId, option.id)
  const title = `${replacing ? 'Replace' : 'Connect'} ${option.name}`
  const submit = () => {
    if (save.isPending || value.length < CREDENTIAL_GROUP_API_KEY_MIN_LENGTH) return
    save.mutate({ value }, { onSuccess: onClose })
  }
  return (
    <ChipModal
      open
      size='sm'
      srTitle={title}
      dismissDisabled={save.isPending}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <ChipModalHeader onClose={onClose} closeDisabled={save.isPending}>
        {title}
      </ChipModalHeader>
      <ChipModalBody>
        {option.description && (
          <p className='px-2 text-[var(--text-muted)] text-sm'>{option.description}</p>
        )}
        <ChipModalField
          type='input'
          inputType='password'
          title='API key'
          value={value}
          onChange={setValue}
          placeholder='Enter your API key'
          hint={`Enter at least ${CREDENTIAL_GROUP_API_KEY_MIN_LENGTH} characters to connect.`}
          autoComplete='new-password'
          maxLength={CREDENTIAL_GROUP_API_KEY_MAX_LENGTH}
          required
          disabled={save.isPending}
        />
        <ChipModalError>{save.error?.message}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={onClose}
        cancelDisabled={save.isPending}
        primaryAction={{
          label: save.isPending ? 'Saving…' : replacing ? 'Replace' : 'Connect',
          disabled: save.isPending || value.length < CREDENTIAL_GROUP_API_KEY_MIN_LENGTH,
          onClick: submit,
        }}
      />
    </ChipModal>
  )
}
