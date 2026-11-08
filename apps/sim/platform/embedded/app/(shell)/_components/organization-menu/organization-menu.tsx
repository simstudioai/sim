'use client'

import { type RefObject, useId, useRef, useState } from 'react'
import { Avatar } from '@sim/emcn/avatar'
import { Button } from '@sim/emcn/button'
import { Input } from '@sim/emcn/field/inputs'
import { IdentityButton } from '@sim/emcn/identity-button'
import { MenuItem } from '@sim/emcn/menu/action-menu'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import { getErrorMessage } from '@sim/utils/errors'
import { LOGO_ACCEPT_ATTRIBUTE } from '@/lib/uploads/client/logo-file'
import { InviteModal } from '@/platform/embedded/app/(shell)/_components/invite-modal/invite-modal'
import styles from '@/platform/embedded/app/(shell)/_components/organization-menu/organization-menu.module.css'
import { useOrganizationActions } from '@/platform/embedded/lib/data/shell-actions'
import type { ShellData } from '@/platform/embedded/lib/data/shell-view'
import { plural } from '@/platform/shared/plural'

function focusNameField(frame: HTMLDivElement | null) {
  const field = frame?.querySelector('input')
  field?.focus()
  field?.select()
}

interface OrganizationMenuProps {
  anchor: RefObject<HTMLElement | null>
  organization: ShellData['organization']
  onOpen: () => void
  onSettings: () => void
}

export function OrganizationMenu({
  anchor,
  organization,
  onOpen,
  onSettings,
}: OrganizationMenuProps) {
  const [open, setOpen] = useState(false)
  const [invite, setInvite] = useState(false)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const actions = useOrganizationActions()
  const { isRenaming: renaming, isUploadingLogo: uploading } = actions
  /** The name just saved, shown until the refreshed surface replaces the one it was saved over. */
  const [savedName, setSavedName] = useState<{ name: string; replaces: string } | null>(null)
  const opener = useRef<HTMLElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const errorId = useId()
  if (savedName && savedName.replaces !== organization.name) setSavedName(null)
  const name = savedName?.name ?? organization.name
  const logo = organization.logo ?? undefined

  function stopRenaming() {
    setDraftName(null)
    setRenameError(null)
  }

  /** The rename field unmounts when the draft ends, and focus would otherwise fall to the page. */
  function returnFocusToCard() {
    requestAnimationFrame(() => card.current?.querySelector('button')?.focus())
  }

  async function submitRename(): Promise<boolean> {
    if (draftName === null || renaming) return false
    const next = draftName.trim()
    if (!next || next === name) {
      stopRenaming()
      return true
    }
    try {
      await actions.rename(next)
      setSavedName({ name: next, replaces: organization.name })
      stopRenaming()
      return true
    } catch (error) {
      setRenameError(getErrorMessage(error, 'Failed to rename organization'))
      return false
    }
  }

  return (
    <>
      <AnchoredPopover
        presentation='menu'
        label='Organization menu'
        triggerLabel={`${name}, organization menu`}
        anchor={anchor}
        open={open}
        onOpenChange={(next, trigger) => {
          // The field's blur saves the draft; closing now would unmount it and hide a failure.
          if (!next && draftName !== null) return
          if (next && trigger instanceof HTMLElement) opener.current = trigger
          if (next) onOpen()
          setOpen(next)
        }}
        trigger={(button) => (
          <IdentityButton
            render={button}
            label={`${name}, organization menu`}
            leading={<Avatar name={name} src={logo} organization size='inline' decorative />}
            trailingIcon='I051'
          >
            {name}
          </IdentityButton>
        )}
      >
        <div ref={card} className={styles.menu}>
          <div className={styles.overview}>
            <Avatar name={name} src={logo} organization size='inline' decorative />
            <div className={styles.copy}>
              {draftName !== null ? (
                <div
                  ref={focusNameField}
                  onBlur={() => void submitRename()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void submitRename().then((saved) => {
                        if (saved) returnFocusToCard()
                      })
                    } else if (event.key === 'Escape') {
                      event.preventDefault()
                      event.stopPropagation()
                      stopRenaming()
                      returnFocusToCard()
                    }
                  }}
                >
                  <Input
                    label='Organization name'
                    placeholder='Organization name'
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
              <span data-type='T050'>{plural(organization.memberCount, 'member')}</span>
            </div>
            {actions.canInvite && (
              <Button
                size='compact'
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
          {actions.canEditIdentity && (
            <>
              <input
                ref={fileInput}
                className={styles.logoInput}
                type='file'
                accept={LOGO_ACCEPT_ATTRIBUTE}
                aria-label='Organization logo'
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file) void actions.uploadLogo(file)
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
        </div>
      </AnchoredPopover>
      {invite && <InviteModal onClose={() => setInvite(false)} />}
    </>
  )
}
