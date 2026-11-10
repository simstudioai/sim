'use client'

import { type RefObject, useId, useRef, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { IdentityButton } from '@sim/emcn/identity-button'
import { MenuItem } from '@sim/emcn/menu/action-menu'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import { Modal } from '@sim/emcn/modal'
import { RecipientField } from '@sim/emcn-platform/workspace-fields'
import { getErrorMessage } from '@sim/utils/errors'
import dynamic from 'next/dynamic'
import styles from '@/app/(product)/_components/organization-menu/organization-menu.module.css'
import type { ShellData, ShellOrganizationActions } from '@/platform/lib/data/models/shell'
import { plural } from '@/platform/shared/plural'

/** Lazy because its form reads real data, which a fixture session never loads. */
const InviteModal = dynamic(
  () =>
    import('@/app/(product)/_components/invite-modal/invite-modal').then(
      (module) => module.InviteModal
    ),
  { ssr: false }
)

/** Lazy like the invite form: both read the viewer's real invitations, which fixtures never have. */
const ViewInvitationsItem = dynamic(
  () =>
    import('@/app/(product)/_components/pending-invitations/pending-invitations').then(
      (module) => module.ViewInvitationsItem
    ),
  { ssr: false }
)

const InvitationsModal = dynamic(
  () =>
    import('@/app/(product)/_components/pending-invitations/invitations-modal').then(
      (module) => module.InvitationsModal
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
  onOpen?: () => void
}

export function OrganizationMenu({
  anchor,
  organization,
  actions,
  onSettings,
  onOpen,
}: OrganizationMenuProps) {
  const [open, setOpen] = useState(false)
  const [invite, setInvite] = useState(false)
  const [invitations, setInvitations] = useState(false)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [uploading, setUploading] = useState(false)
  /** The name just saved, shown until the refreshed surface replaces the one it was saved over. */
  const [savedName, setSavedName] = useState<{ name: string; replaces: string } | null>(null)
  const opener = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const card = useRef<HTMLDivElement>(null)
  /** Set while focus moves back to Rename organization, which is not a blur that saves. */
  const movingFocus = useRef(false)
  const errorId = useId()
  if (savedName && savedName.replaces !== organization?.name) setSavedName(null)
  const name = savedName?.name ?? organization?.name ?? 'Organization'
  const logo = organization?.logo ?? undefined

  function stopRenaming() {
    setDraftName(null)
    setRenameError(null)
  }

  /**
   * Focus moves back to Rename organization before the field unmounts: once the focused field is
   * gone, the popover restores focus to itself instead.
   */
  function focusRenameItem() {
    movingFocus.current = true
    card.current?.querySelector<HTMLElement>('[data-menu-row]')?.focus()
    movingFocus.current = false
  }

  async function submitRename({ returnFocus }: { returnFocus: boolean }) {
    if (draftName === null || renaming || !actions || !organization) return
    const next = draftName.trim()
    if (next && next !== name) {
      setRenaming(true)
      try {
        await actions.rename(next)
      } catch (error) {
        setRenameError(getErrorMessage(error, 'Failed to rename organization'))
        return
      } finally {
        setRenaming(false)
      }
      setSavedName({ name: next, replaces: organization.name })
    }
    if (returnFocus) focusRenameItem()
    stopRenaming()
  }

  async function uploadLogo(file: File | undefined) {
    if (!file || uploading || !actions) return
    setUploading(true)
    await actions.uploadLogo(file)
    setUploading(false)
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
          if (next) onOpen?.()
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
        <div ref={card} className={styles.menu}>
          <div className={styles.overview}>
            <Avatar name={name} src={logo} organization size='inline' />
            <div className={styles.copy}>
              {draftName !== null ? (
                <div
                  ref={focusNameField}
                  onBlur={() => {
                    if (!movingFocus.current) void submitRename({ returnFocus: false })
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitRename({ returnFocus: true })
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      focusRenameItem()
                      stopRenaming()
                    }
                  }}
                >
                  <Input
                    placeholder='Organization name'
                    label='Organization name'
                    value={draftName}
                    disabled={renaming}
                    invalid={Boolean(renameError)}
                    describedBy={renameError ? errorId : undefined}
                    onChange={(value) => {
                      setDraftName(value)
                      setRenameError(null)
                    }}
                  />
                </div>
              ) : (
                <span data-type='T059'>{name}</span>
              )}
              {renameError && (
                <span id={errorId} className={styles.error} role='alert' data-type='T052'>
                  {renameError}
                </span>
              )}
              {organization && (
                <span data-type='T050'>{plural(organization.memberCount, 'member')}</span>
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
          {actions?.canEditIdentity && (
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
              <MenuItem
                label='Rename organization'
                icon='I036'
                onSelect={() => setDraftName(name)}
              />
              <MenuItem
                label='Change organization logo'
                icon='I059'
                detail={uploading ? 'Uploading' : undefined}
                disabled={uploading}
                onSelect={() => fileInput.current?.click()}
              />
            </>
          )}
          <MenuItem
            label='Settings'
            icon='I116'
            onSelect={() => {
              setOpen(false)
              onSettings()
            }}
          />
          {actions && (
            <ViewInvitationsItem
              onOpen={() => {
                opener.current?.focus({ preventScroll: true })
                setOpen(false)
                setInvitations(true)
              }}
            />
          )}
        </div>
      </AnchoredPopover>
      {actions && invitations && (
        <InvitationsModal open={invitations} onOpenChange={setInvitations} />
      )}
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
