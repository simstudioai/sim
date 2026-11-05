'use client'

import { type RefObject, useRef, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import dynamic from 'next/dynamic'
import type { ShellData, ShellOrganizationActions } from '@/platform/app/(shell)/_components/model'
import styles from '@/platform/app/(shell)/_components/organization-menu/organization-menu.module.css'
import {
  Avatar,
  Button,
  Input,
  MenuItem,
  Modal,
  RecipientField,
  Tooltip,
} from '@/platform/design-system/components'
import { IdentityButton } from '@/platform/design-system/components/identity-button/identity-button'
import { AnchoredPopover } from '@/platform/design-system/components/menu/anchored-popover'
import { toast } from '@/platform/lib/data/toast'

/** Lazy because its form reads real data, which a fixture session never loads. */
const InviteModal = dynamic(
  () =>
    import('@/platform/app/(shell)/_components/invite-modal/invite-modal').then(
      (module) => module.InviteModal
    ),
  { ssr: false }
)

function focusNameField(frame: HTMLDivElement | null) {
  const field = frame?.querySelector('input')
  field?.focus()
  field?.select()
}

interface OrganizationMenuProps {
  anchor: RefObject<HTMLElement | null>
  organization?: ShellData['organization']
  actions?: ShellOrganizationActions
  onSettings: () => void
}

export function OrganizationMenu({
  anchor,
  organization,
  actions,
  onSettings,
}: OrganizationMenuProps) {
  const [open, setOpen] = useState(false)
  const [invite, setInvite] = useState(false)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [uploading, setUploading] = useState(false)
  /** The name just saved, shown until the refreshed surface replaces the one it was saved over. */
  const [savedName, setSavedName] = useState<{ name: string; replaces: string } | null>(null)
  const opener = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  if (savedName && savedName.replaces !== organization?.name) setSavedName(null)
  const name = savedName?.name ?? organization?.name ?? 'Organization'
  const logo = organization?.logo ?? undefined
  const canEdit = Boolean(actions?.canEditIdentity)

  function stopRenaming() {
    setDraftName(null)
    setRenameError(null)
  }

  async function submitRename() {
    if (draftName === null || renaming || !actions || !organization) return
    const next = draftName.trim()
    if (!next || next === name) {
      stopRenaming()
      return
    }
    setRenaming(true)
    try {
      await actions.rename(next)
      setSavedName({ name: next, replaces: organization.name })
      stopRenaming()
    } catch (error) {
      setRenameError(getErrorMessage(error, 'Failed to rename organization'))
    } finally {
      setRenaming(false)
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file || uploading || !actions) return
    setUploading(true)
    try {
      await actions.uploadLogo(file)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Failed to upload logo'))
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <AnchoredPopover
        presentation='menu'
        label='Organization menu'
        anchor={anchor}
        open={open}
        onOpenChange={(next, trigger) => {
          // The field's blur saves the draft; closing now would unmount it and hide a failure.
          if (!next && draftName !== null) return
          if (next && trigger instanceof HTMLElement) opener.current = trigger
          setOpen(next)
        }}
        trigger={(button) => (
          <IdentityButton
            render={button}
            label='Organization menu'
            leading={organization && <Avatar name={name} src={logo} organization size='inline' />}
          >
            {name}
          </IdentityButton>
        )}
      >
        <div className={styles.menu}>
          <div className={styles.overview}>
            {canEdit && actions ? (
              <>
                <input
                  ref={fileInput}
                  className={styles.logoInput}
                  type='file'
                  accept={actions.logoAccept}
                  aria-label='Organization logo'
                  disabled={uploading}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    void uploadLogo(file)
                  }}
                />
                <Tooltip label={uploading ? 'Uploading' : 'Change logo'}>
                  <button
                    type='button'
                    className={styles.logoButton}
                    aria-label='Change organization logo'
                    aria-busy={uploading}
                    disabled={uploading}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Avatar name={name} src={logo} organization size='inline' />
                  </button>
                </Tooltip>
              </>
            ) : (
              <Avatar name={name} src={logo} organization size='inline' />
            )}
            <div className={styles.copy}>
              {draftName !== null ? (
                <div
                  ref={focusNameField}
                  onBlur={() => void submitRename()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitRename()
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      stopRenaming()
                    }
                  }}
                >
                  <Input
                    label='Organization name'
                    value={draftName}
                    disabled={renaming}
                    invalid={Boolean(renameError)}
                    onChange={(value) => {
                      setDraftName(value)
                      setRenameError(null)
                    }}
                  />
                </div>
              ) : canEdit ? (
                <button
                  type='button'
                  className={styles.nameButton}
                  aria-label='Rename organization'
                  data-type='T059'
                  onClick={() => setDraftName(name)}
                >
                  {name}
                </button>
              ) : (
                <span data-type='T059'>{name}</span>
              )}
              {renameError && (
                <span className={styles.error} role='alert' data-type='T052'>
                  {renameError}
                </span>
              )}
              {organization && (
                <span data-type='T050'>
                  {organization.memberCount} {organization.memberCount === 1 ? 'member' : 'members'}
                </span>
              )}
            </div>
            {(!actions || actions.canInvite) && (
              <Button
                size='compact'
                disabled={!organization}
                onClick={() => {
                  opener.current?.focus({ preventScroll: true })
                  setOpen(false)
                  setInvite(true)
                }}
              >
                Invite
              </Button>
            )}
          </div>
          <MenuItem
            label='Settings'
            icon='I116'
            onSelect={() => {
              setOpen(false)
              onSettings()
            }}
          />
        </div>
      </AnchoredPopover>
      {actions ? (
        invite && <InviteModal open={invite} onOpenChange={setInvite} />
      ) : (
        <Modal
          title='Invite people'
          open={invite}
          onOpenChange={setInvite}
          confirmLabel='Invite'
          confirmDisabled
        >
          <RecipientField
            label='Email addresses'
            name='recipients'
            placeholder='name@company.com'
          />
        </Modal>
      )}
    </>
  )
}
