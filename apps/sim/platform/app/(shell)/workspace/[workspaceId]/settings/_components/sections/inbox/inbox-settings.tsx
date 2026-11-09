'use client'

import { useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { Modal } from '@sim/emcn/modal'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { toast } from '@/lib/toast/sink'
import { FieldStack, Muted } from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import {
  type InboxConfig,
  useAddInboxSender,
  useInboxSenders,
  useRawMountableSecretOptions,
  useRemoveInboxSender,
  useUpdateInboxAddress,
  useUpdateInboxSecretPolicy,
} from '@/platform/lib/data/inbox'

const SECRET_SCOPE_OPTIONS = [
  { value: 'all', label: 'All secrets' },
  { value: 'selected', label: 'Selected secrets' },
]

interface InboxSettingsProps
  extends Pick<InboxConfig, 'address' | 'secretScope' | 'mountedSecrets'> {
  workspaceId: string
}

/** The inbox's address, who may email it, and which secrets its tasks may read. */
export function InboxSettings({
  workspaceId,
  address,
  secretScope,
  mountedSecrets,
}: InboxSettingsProps) {
  const senders = useInboxSenders(workspaceId)
  const updateAddress = useUpdateInboxAddress()
  const updateSecretPolicy = useUpdateInboxSecretPolicy()
  const addSender = useAddInboxSender()
  const removeSender = useRemoveInboxSender()
  const secretOptions = useRawMountableSecretOptions(workspaceId)

  const [addingSender, setAddingSender] = useState(false)
  const [senderEmail, setSenderEmail] = useState('')
  const [senderLabel, setSenderLabel] = useState('')
  const [editingAddress, setEditingAddress] = useState(false)
  const [username, setUsername] = useState('')

  async function handleRemoveSender(senderId: string) {
    try {
      await removeSender.mutateAsync({ workspaceId, senderId })
    } catch (caught) {
      toast.error(getErrorMessage(caught, 'Failed to remove sender'))
    }
  }

  return (
    <>
      {address && (
        <SettingsSection title='Sim’s email'>
          <FieldStack>
            <TextField
              label='Address'
              value={address}
              viewOnly
              placeholder=''
              hint='Send emails here to create tasks.'
            />
          </FieldStack>
          <SettingsRow
            label='Change address'
            description='Changing the address creates a new inbox. The old address stops receiving emails immediately.'
          >
            <Button
              variant='quiet'
              destructive
              onClick={() => {
                setUsername('')
                setEditingAddress(true)
              }}
            >
              Change address
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      <SettingsSection title='Allowed senders'>
        <FieldStack>
          <Muted>Only emails from these addresses can create tasks.</Muted>
        </FieldStack>
        {senders.isPending ? null : senders.data === undefined ? (
          <FieldStack>
            <FailureNotice
              message={getErrorMessage(senders.error, 'Failed to load allowed senders')}
              retrying={senders.isFetching}
              onRetry={() => void senders.refetch()}
            />
          </FieldStack>
        ) : senders.data.workspaceMembers.length === 0 && senders.data.senders.length === 0 ? (
          <FieldStack>
            <Muted>No allowed senders configured.</Muted>
          </FieldStack>
        ) : (
          <>
            {senders.data.workspaceMembers.map((member) => (
              <SettingsRow key={member.email} label={member.email} description='Member' />
            ))}
            {senders.data.senders.map((sender) => (
              <SettingsRow
                key={sender.id}
                label={sender.email}
                description={sender.label ?? undefined}
              >
                <IconButton
                  label={`Remove ${sender.email}`}
                  icon='I105'
                  onClick={() => void handleRemoveSender(sender.id)}
                />
              </SettingsRow>
            ))}
          </>
        )}
        <SettingsRow label='Add sender'>
          <Button
            size='compact'
            icon='I074'
            onClick={() => {
              setSenderEmail('')
              setSenderLabel('')
              setAddingSender(true)
            }}
          >
            Add sender
          </Button>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title='Secrets'>
        <SettingsRow label='Secret access'>
          <ChoiceMenu
            label='Secret access'
            options={SECRET_SCOPE_OPTIONS}
            value={secretScope}
            disabled={updateSecretPolicy.isPending}
            onValueChange={(value) =>
              updateSecretPolicy.mutate({
                workspaceId,
                secretScope: value === 'selected' ? 'selected' : 'all',
                mountedSecrets,
              })
            }
          />
        </SettingsRow>
        {secretScope === 'selected' && (
          <SettingsRow label='Secrets'>
            <MultiSelect
              label='Secrets'
              labelHidden
              variant='text'
              options={secretOptions.options}
              value={mountedSecrets}
              onValueChange={(values) =>
                updateSecretPolicy.mutate({
                  workspaceId,
                  secretScope: 'selected',
                  mountedSecrets: values,
                })
              }
              placeholder='Select secrets'
              searchLabel='Search secrets'
              disabled={secretOptions.isPending || updateSecretPolicy.isPending}
            />
          </SettingsRow>
        )}
        {updateSecretPolicy.error && (
          <FieldStack>
            <InlineNotice
              intent='danger'
              message={getErrorMessage(updateSecretPolicy.error, 'Failed to update secret access')}
            />
          </FieldStack>
        )}
      </SettingsSection>
      <Modal
        open={addingSender}
        onOpenChange={setAddingSender}
        title='Add allowed sender'
        confirmLabel='Add'
        confirmDisabled={!senderEmail.trim() || addSender.isPending}
        pending={addSender.isPending}
        onConfirm={() =>
          addSender.mutateAsync({
            workspaceId,
            email: senderEmail.trim(),
            label: senderLabel.trim() || undefined,
          })
        }
      >
        <TextField
          type='email'
          label='Email address'
          required
          value={senderEmail}
          onChange={setSenderEmail}
          placeholder='user@example.com'
          autoComplete='off'
        />
        <TextField
          label='Label'
          optional
          value={senderLabel}
          onChange={setSenderLabel}
          placeholder='e.g., John from Marketing'
          autoComplete='off'
        />
      </Modal>
      <Modal
        destructive
        open={editingAddress}
        onOpenChange={setEditingAddress}
        title='Change email address'
        description='Changing your email address will create a new inbox. The old address will stop receiving emails immediately.'
        confirmLabel={updateAddress.isPending ? 'Updating…' : 'Change address'}
        confirmDisabled={!username.trim() || updateAddress.isPending}
        pending={updateAddress.isPending}
        onConfirm={() => updateAddress.mutateAsync({ workspaceId, username: username.trim() })}
      >
        <TextField
          label='New email prefix'
          value={username}
          onChange={setUsername}
          placeholder='e.g., new-acme'
          autoComplete='off'
        />
      </Modal>
    </>
  )
}
