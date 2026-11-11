'use client'

import { useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { MultiSelect } from '@sim/emcn/picker/multi-select'
import { Select } from '@sim/emcn/picker/select'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { InlineNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import { FieldStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import {
  type InboxConfig,
  useAddInboxSender,
  useInboxSenders,
  useRawMountableSecretOptions,
  useRemoveInboxSender,
  useUpdateInboxAddress,
  useUpdateInboxSecretPolicy,
} from '@/platform/lib/data/inbox'
import { plural } from '@/platform/shared/plural'

const SECRET_SCOPE_OPTIONS = [
  { value: 'all', label: 'All secrets' },
  { value: 'selected', label: 'Selected secrets' },
]

interface InboxDialogProps {
  workspaceId: string
  onClose: () => void
}

/** Allows one more address to email tasks, holding its own draft. */
function AddSenderDialog({ workspaceId, onClose }: InboxDialogProps) {
  const addSender = useAddInboxSender()
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Add allowed sender'
      confirmLabel='Add sender'
      confirmDisabled={!email.trim() || addSender.isPending}
      pending={addSender.isPending}
      onConfirm={() =>
        addSender.mutateAsync({
          workspaceId,
          email: email.trim(),
          label: label.trim() || undefined,
        })
      }
    >
      <TextField
        type='email'
        label='Email address'
        required
        value={email}
        onChange={setEmail}
        placeholder='user@example.com'
        autoComplete='off'
      />
      <TextField
        label='Label'
        optional
        value={label}
        onChange={setLabel}
        placeholder='e.g., John from Marketing'
        autoComplete='off'
      />
    </Modal>
  )
}

/** Replaces the inbox with one at a new address, holding its own draft. */
function ChangeAddressDialog({ workspaceId, onClose }: InboxDialogProps) {
  const updateAddress = useUpdateInboxAddress()
  const [username, setUsername] = useState('')
  return (
    <Modal
      destructive
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Change email address'
      description='A new inbox replaces this one, and the old address stops receiving email at once'
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
  )
}

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
  const updateSecretPolicy = useUpdateInboxSecretPolicy()
  const removeSender = useRemoveInboxSender()
  const secretOptions = useRawMountableSecretOptions(workspaceId)

  const [dialog, setDialog] = useState<'add-sender' | 'change-address' | null>(null)
  const [removingSender, setRemovingSender] = useState<{ id: string; email: string } | null>(null)

  const addSender = (
    <Button size='compact' icon='I074' onClick={() => setDialog('add-sender')}>
      Add sender
    </Button>
  )

  return (
    <>
      {address && (
        <SettingsSection title='Sim’s email'>
          <SettingsRow label='Address' description={address}>
            <Button size='compact' onClick={() => setDialog('change-address')}>
              Change address
            </Button>
          </SettingsRow>
        </SettingsSection>
      )}
      <SettingsRead query={senders} failureMessage='Couldn’t load allowed senders'>
        {({ workspaceMembers, senders: allowed }) => (
          <SettingsList
            title='Allowed senders'
            empty={
              workspaceMembers.length === 0 && allowed.length === 0
                ? { title: 'No allowed senders yet', action: addSender }
                : undefined
            }
          >
            {workspaceMembers.length > 0 && (
              <SettingsRow
                label='Workspace members'
                description={`${plural(workspaceMembers.length, 'member')} can email tasks`}
              />
            )}
            {allowed.map((sender) => (
              <SettingsRow
                key={sender.id}
                label={sender.email}
                description={sender.label ?? undefined}
              >
                <IconButton
                  label={`Remove ${sender.email}`}
                  icon='I105'
                  onClick={() => setRemovingSender({ id: sender.id, email: sender.email })}
                />
              </SettingsRow>
            ))}
            <SettingsRow label='New sender' description='Allow another address to email tasks'>
              {addSender}
            </SettingsRow>
          </SettingsList>
        )}
      </SettingsRead>
      <SettingsSection title='Secrets'>
        <SettingsRow
          label='Secret access'
          description='Choose which secrets email tasks can use'
          field
        >
          <Select
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
          <SettingsRow label='Secrets' description='The secrets email tasks can read'>
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
      <ConfirmDialog
        target={removingSender}
        onClose={() => setRemovingSender(null)}
        title='Remove sender'
        description={({ email }) => `Emails from ${email} will no longer create tasks.`}
        confirmLabel='Remove'
        pendingLabel='Removing…'
        onConfirm={({ id }) => removeSender.mutateAsync({ workspaceId, senderId: id })}
      />
      {dialog === 'add-sender' && (
        <AddSenderDialog workspaceId={workspaceId} onClose={() => setDialog(null)} />
      )}
      {dialog === 'change-address' && (
        <ChangeAddressDialog workspaceId={workspaceId} onClose={() => setDialog(null)} />
      )}
    </>
  )
}
