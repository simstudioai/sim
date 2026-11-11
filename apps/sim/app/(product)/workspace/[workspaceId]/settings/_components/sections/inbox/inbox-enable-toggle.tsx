'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { Switch } from '@sim/emcn/switch'
import { Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { useToggleInbox } from '@/platform/lib/data/inbox'

interface InboxEnableToggleProps {
  workspaceId: string
  enabled: boolean
  address: string | null
}

/** Turns the workspace's email inbox on, choosing its address, or off. */
export function InboxEnableToggle({ workspaceId, enabled, address }: InboxEnableToggleProps) {
  const toggleInbox = useToggleInbox()
  const [enabling, setEnabling] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const [username, setUsername] = useState('')

  return (
    <SettingsSection title='Email inbox'>
      <SettingsRow
        label='Enable email inbox'
        description='Allow this workspace to receive tasks by email'
      >
        <Switch
          label='Enable email inbox'
          checked={enabled}
          disabled={toggleInbox.isPending}
          onCheckedChange={(checked) => {
            toggleInbox.reset()
            if (checked) {
              setUsername('')
              setEnabling(true)
            } else setDisabling(true)
          }}
        />
      </SettingsRow>
      <Modal
        open={enabling}
        onOpenChange={setEnabling}
        title='Enable email inbox'
        description='An email address will be created for this workspace. Anyone in the allowed senders list can email it to create tasks.'
        confirmLabel={toggleInbox.isPending ? 'Enabling…' : 'Enable'}
        pending={toggleInbox.isPending}
        onConfirm={() =>
          toggleInbox.mutateAsync({
            workspaceId,
            enabled: true,
            username: username.trim() || undefined,
          })
        }
      >
        <TextField
          label='Email prefix'
          optional
          value={username}
          onChange={setUsername}
          placeholder='Leave blank to auto-generate'
          autoComplete='off'
        />
      </Modal>
      <ConfirmDialog
        target={disabling}
        onClose={() => setDisabling(false)}
        title='Disable email inbox'
        description={`Are you sure you want to disable the inbox${address ? ` ${address}` : ''}? Any emails sent to this address after disabling will not be delivered. This action cannot be undone.`}
        confirmLabel='Disable inbox'
        pendingLabel='Disabling…'
        pending={toggleInbox.isPending}
        onConfirm={() => toggleInbox.mutateAsync({ workspaceId, enabled: false })}
      >
        <Muted>Your existing conversations and task history will be preserved.</Muted>
      </ConfirmDialog>
    </SettingsSection>
  )
}
