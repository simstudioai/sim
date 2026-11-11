'use client'

import { useState } from 'react'
import { TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SettingsSection } from '@sim/emcn/settings-section'
import { Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import { SwitchRow } from '@/app/(product)/_components/settings-parts/switch-row'
import { useToggleInbox } from '@/platform/lib/data/inbox'

interface InboxEnableToggleProps {
  workspaceId: string
  enabled: boolean
  address: string | null
}

/** Creates the workspace's inbox, with an optional address prefix held in its own draft. */
function EnableInboxDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const toggleInbox = useToggleInbox()
  const [username, setUsername] = useState('')
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title='Enable email inbox'
      description='Anyone on the allowed senders list can email the new address to create tasks'
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
  )
}

/** Turns the workspace's email inbox on, choosing its address, or off. */
export function InboxEnableToggle({ workspaceId, enabled, address }: InboxEnableToggleProps) {
  const toggleInbox = useToggleInbox()
  const [enabling, setEnabling] = useState(false)
  const [disabling, setDisabling] = useState(false)

  return (
    <SettingsSection title='Email inbox'>
      <SwitchRow
        label='Enable email inbox'
        description='Allow this workspace to receive tasks by email'
        checked={enabled}
        disabled={toggleInbox.isPending}
        onCheckedChange={(checked) => {
          toggleInbox.reset()
          if (checked) setEnabling(true)
          else setDisabling(true)
        }}
      />
      {enabling && (
        <EnableInboxDialog workspaceId={workspaceId} onClose={() => setEnabling(false)} />
      )}
      <ConfirmDialog
        target={disabling}
        onClose={() => setDisabling(false)}
        title='Disable email inbox'
        description={`${address ?? 'The inbox address'} is deleted and stops receiving email. Turning the inbox back on creates a new address.`}
        confirmLabel='Disable inbox'
        pendingLabel='Disabling…'
        pending={toggleInbox.isPending}
        onConfirm={() => toggleInbox.mutateAsync({ workspaceId, enabled: false })}
      >
        <Muted>Your conversations and task history stay</Muted>
      </ConfirmDialog>
    </SettingsSection>
  )
}
