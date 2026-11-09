'use client'

import { useId, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { FieldFrame, fieldDescription } from '@sim/emcn/field'
import { Input } from '@sim/emcn/field/inputs'
import { CopyField } from '@sim/emcn/field/value-fields'
import { Modal } from '@sim/emcn/modal'
import { ConfirmDialog } from '@sim/emcn/modal/confirm-dialog'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { RecipientField } from '@sim/emcn-platform/workspace-fields'
import { randomInt } from '@sim/utils/random'
import { LinkEditor } from '@/app/(product)/_components/links-page/link-editor'
import {
  type ShareDialogProps,
  useShareDialog,
} from '@/app/(product)/_components/workspace/files/share-modal/use-share-dialog'
import { simLinkUrl, suggestSimLinkName, useSimLinksForUrl } from '@/platform/lib/data/files'
import { useOrganization } from '@/platform/lib/data/organization'

const PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='
const GENERATED_PASSWORD_LENGTH = 24

function generatePassword(): string {
  let password = ''
  for (let index = 0; index < GENERATED_PASSWORD_LENGTH; index++) {
    password += PASSWORD_ALPHABET.charAt(randomInt(0, PASSWORD_ALPHABET.length))
  }
  return password
}

interface SharePasswordFieldProps {
  value: string
  onChange: (value: string) => void
  /** A password is already saved, so a blank field keeps it. */
  keepsCurrent: boolean
  disabled: boolean
}

/** The share password: typed or generated, revealed on request and copied once shown. */
function SharePasswordField({ value, onChange, keepsCurrent, disabled }: SharePasswordFieldProps) {
  const id = useId()
  const [revealed, setRevealed] = useState(false)
  const hint = keepsCurrent
    ? 'Leave blank to keep the current password.'
    : 'Anyone with the link must enter this password.'
  return (
    <FieldFrame id={id} label='Password' hint={hint}>
      <Input
        id={id}
        label='Password'
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={keepsCurrent ? '••••••••' : 'Enter a password'}
        autoComplete='new-password'
        spellCheck={false}
        disabled={disabled}
        describedBy={fieldDescription(id, undefined, hint)}
        trailing={
          <>
            <IconButton
              label='Generate password'
              icon='I065'
              size='compact'
              tooltip
              disabled={disabled}
              onClick={() => {
                onChange(generatePassword())
                setRevealed(true)
              }}
            />
            <IconButton
              label={revealed ? 'Hide password' : 'Show password'}
              icon={revealed ? 'eye-off' : 'eye'}
              size='compact'
              tooltip
              disabled={disabled}
              onClick={() => setRevealed((current) => !current)}
            />
            {value && <CopyButton label='Copy password' text={value} size='compact' />}
          </>
        }
      />
    </FieldFrame>
  )
}

/**
 * The organization's short link for a shared file: copies the link that already opens it, or
 * offers to create one. Absent where Sim links are off, and while the lookup has failed, so the
 * dialog never offers a duplicate.
 */
function useSimLinkAction(url: string | undefined, title: string) {
  const organization = useOrganization()
  const organizationId = organization.navFlags.simLinks ? organization.organization.id : ''
  const links = useSimLinksForUrl(organizationId, url ?? '', Boolean(url))
  const { copied, copy } = useClipboard()
  const [creating, setCreating] = useState(false)
  const existing = links.data?.at(0)
  const action =
    !organizationId || !url || links.isError
      ? undefined
      : existing
        ? {
            label: copied ? 'Copied' : `Copy sim/${existing.name}`,
            icon: copied ? ('I072' as const) : ('link' as const),
            onClick: () => void copy(simLinkUrl(window.location.origin, existing.name)),
          }
        : {
            label: 'Create link',
            icon: 'I074' as const,
            disabled: links.isLoading,
            onClick: () => setCreating(true),
          }
  const editor =
    creating && organizationId && url ? (
      <LinkEditor
        organizationId={organizationId}
        initialUrl={url}
        initialName={suggestSimLinkName(title)}
        onClose={() => setCreating(false)}
      />
    ) : null
  return { action, editor }
}

/**
 * Shares a file through a public link: anyone with it, a password, a one-time code sent to
 * allowed emails, or SSO. The link and its short link stay offered while the share is active.
 */
export function ShareModal(props: ShareDialogProps) {
  const { open, fileName } = props
  const dialog = useShareDialog(props)
  const { saved } = dialog
  const activeUrl = saved?.isActive && saved.url ? saved.url : undefined
  const simLink = useSimLinkAction(activeUrl, fileName.replace(/\.[^.]+$/, ''))
  return (
    <>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!next) dialog.close()
        }}
        title='Share file'
        accessibleName={`Share ${fileName}`}
        confirmLabel={dialog.primaryLabel}
        confirmDisabled={dialog.primaryDisabled}
        destructive={dialog.isUnshareAction}
        pending={dialog.pending}
        submitOnEnter={!dialog.isUnshareAction}
        footerStartAction={simLink.action}
        onConfirm={dialog.runPrimaryAction}
      >
        <FieldFrame label='Access' hint={dialog.accessHint}>
          <SegmentedControl
            label='File access'
            options={dialog.accessModes.map((mode) => ({
              ...mode,
              disabled: dialog.pending,
            }))}
            value={dialog.mode}
            onSelect={dialog.setMode}
            holdOnReselect
          />
        </FieldFrame>
        {dialog.mode === 'password' && (
          <SharePasswordField
            value={dialog.password}
            onChange={dialog.setPassword}
            keepsCurrent={Boolean(saved?.hasPassword)}
            disabled={dialog.pending}
          />
        )}
        {dialog.usesAllowlist && (
          <RecipientField
            label='Allowed emails'
            placeholder='Enter emails or domains'
            recipients={dialog.emails.map((address) => ({
              address,
              invalid: !dialog.validateEmail(address),
            }))}
            onRecipientsChange={(recipients) =>
              dialog.setEmails(recipients.map(({ address }) => address))
            }
            validate={dialog.validateEmail}
            error={dialog.emailsError}
            hint='An email address, or a domain such as @example.com.'
            disabled={dialog.pending}
          />
        )}
        {activeUrl && <CopyField label='Link' value={activeUrl} />}
      </Modal>
      {simLink.editor}
      <ConfirmDialog
        target={open && dialog.unshareConfirmOpen}
        onClose={() => dialog.setUnshareConfirmOpen(false)}
        title='Unshare file?'
        description='Anyone with the link will lose access.'
        confirmLabel='Unshare'
        pendingLabel='Unsharing…'
        onConfirm={dialog.confirmUnshare}
      />
    </>
  )
}
