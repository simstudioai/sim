'use client'

import { useId, useState } from 'react'
import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { generatePassword } from '@/lib/core/security/encryption'
import { RedesignSurface } from '@/app/o/[organizationId]/_redesign/redesign-host'
import {
  useOpenSimLinkForm,
  useSimLinkOrganizationId,
} from '@/app/o/[organizationId]/links/sim-link-organization-provider'
import { useExistingSimLink } from '@/app/o/[organizationId]/links/sim-link-shortcut'
import type { ShareDialogModel } from '@/app/workspace/[workspaceId]/files/components/share-modal'
import styles from '@/platform/app/(shell)/_components/conversation/conversation.module.css'
import {
  Button,
  CopyButton,
  FieldFrame,
  InlineNotice,
  Input,
  Modal,
  RecipientField,
  SegmentedControl,
} from '@/platform/design-system/components'
import { fieldDescription } from '@/platform/design-system/components/field/fields'

const GENERATED_PASSWORD_LENGTH = 24

interface PasswordFieldProps {
  value: string
  onChange: (value: string) => void
  disabled: boolean
  placeholder: string
  hint: string
}

function PasswordField({ value, onChange, disabled, placeholder, hint }: PasswordFieldProps) {
  const id = useId()
  const [revealed, setRevealed] = useState(false)
  return (
    <FieldFrame id={id} label='Password' hint={hint}>
      <Input
        id={id}
        label='Password'
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete='new-password'
        spellCheck={false}
        describedBy={fieldDescription(id, undefined, hint)}
        trailing={
          <>
            <Button
              variant='quiet'
              size='compact'
              disabled={disabled}
              onClick={() => onChange(generatePassword(GENERATED_PASSWORD_LENGTH))}
            >
              Generate
            </Button>
            <Button
              variant='quiet'
              size='compact'
              disabled={disabled}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? 'Hide' : 'Show'}
            </Button>
            {value && !disabled && <CopyButton label='Copy password' text={value} />}
          </>
        }
      />
    </FieldFrame>
  )
}

interface AllowedEmailsFieldProps {
  value: string[]
  onChange: (emails: string[]) => void
  validator: (entry: string) => string | null
  disabled: boolean
}

function entryProblem(entry: string, validator: AllowedEmailsFieldProps['validator']) {
  const email = normalizeEmail(entry)
  if (!isValidEmailSyntax(email, true)) return 'Invalid email or domain'
  return validator(email)
}

/**
 * Only accepted entries reach the share, normalized as the legacy field does. A rejected entry stays
 * here as an invalid tag, which also holds the form until it is removed.
 */
function AllowedEmailsField({ value, onChange, validator, disabled }: AllowedEmailsFieldProps) {
  const [rejected, setRejected] = useState<string[]>([])
  const problem = rejected.map((entry) => entryProblem(entry, validator)).find(Boolean)
  return (
    <RecipientField
      label='Allowed emails'
      placeholder='Enter emails or domains'
      disabled={disabled}
      error={problem ?? undefined}
      recipients={[
        ...value.map((address) => ({ address })),
        ...rejected.map((address) => ({ address, invalid: true })),
      ]}
      validate={(entry) => !entryProblem(entry, validator)}
      onRecipientsChange={(next) => {
        const accepted = next.filter((entry) => !entry.invalid).map((entry) => entry.address)
        setRejected(next.filter((entry) => entry.invalid).map((entry) => entry.address))
        onChange([...new Set(accepted.map(normalizeEmail))])
      }}
    />
  )
}

interface SimLinkButtonProps {
  organizationId: string
  url: string
  title: string
}

/** Opens the layout's `LinkEditor`, whose native dialog stacks above this one. */
function SimLinkButton({ organizationId, url, title }: SimLinkButtonProps) {
  const openForm = useOpenSimLinkForm()
  const { existing, isPending, isError, copied, copyExisting } = useExistingSimLink(
    organizationId,
    url
  )
  if (isError) return null
  if (existing) {
    return (
      <Button variant='secondary' size='compact' onClick={() => void copyExisting()}>
        {copied ? 'Copied!' : `Copy sim/${existing.name}`}
      </Button>
    )
  }
  return (
    <Button
      variant='secondary'
      size='compact'
      disabled={isPending}
      onClick={() => openForm(url, title)}
    >
      Create link
    </Button>
  )
}

/**
 * The design's share dialog. `ShareModal` keeps every rule and request; a save stays in the dialog
 * on success, so `onConfirm` answers `false`, and a failure shows here as the page's toast sits
 * under the native dialog.
 */
export function ShareDialog(dialog: ShareDialogModel) {
  const organizationId = useSimLinkOrganizationId()
  const { saved, mode, pending, error } = dialog
  const url = saved?.isActive ? saved.url : undefined
  const failure = error && <InlineNotice intent='danger' message={error} />
  return (
    <div className={styles.dialogHost}>
      <RedesignSurface>
        <Modal
          open
          onOpenChange={() => {
            if (!pending) dialog.onClose()
          }}
          title='Share file'
          confirmLabel={dialog.primaryLabel}
          confirmDisabled={dialog.primaryDisabled}
          destructive={dialog.isUnshareAction}
          onConfirm={() => {
            dialog.onPrimaryAction()
            return false
          }}
        >
          {/* Unsharing asks first, so Enter in a field does not start it, as in the legacy footer. */}
          <div
            className={styles.shareFields}
            onKeyDown={(event) => {
              if (
                event.key === 'Enter' &&
                dialog.isUnshareAction &&
                event.target instanceof HTMLInputElement
              )
                event.preventDefault()
            }}
          >
            <FieldFrame label='Access' hint={dialog.accessHint}>
              <SegmentedControl
                label='File access'
                value={mode}
                options={dialog.accessModes.map((option) => ({
                  ...option,
                  disabled: pending,
                }))}
                onSelect={dialog.onModeChange}
              />
            </FieldFrame>
            {mode === 'password' && (
              <PasswordField
                value={dialog.password}
                onChange={dialog.onPasswordChange}
                disabled={pending}
                placeholder={saved?.hasPassword ? '••••••••' : 'Enter a password'}
                hint={
                  saved?.hasPassword
                    ? 'Leave blank to keep the current password.'
                    : 'Anyone with the link must enter this password.'
                }
              />
            )}
            {(mode === 'email' || mode === 'sso') && (
              <AllowedEmailsField
                value={dialog.emails}
                onChange={dialog.onEmailsChange}
                validator={dialog.emailValidator}
                disabled={pending}
              />
            )}
          </div>
          {url && (
            <div className={styles.shareLinks}>
              <Button variant='secondary' size='compact' onClick={() => dialog.onCopyLink(url)}>
                {dialog.copied ? 'Copied!' : 'Copy link'}
              </Button>
              {organizationId && (
                <SimLinkButton
                  organizationId={organizationId}
                  url={url}
                  title={dialog.fileName.replace(/\.[^.]+$/, '')}
                />
              )}
            </div>
          )}
          {!dialog.unshareConfirmOpen && failure}
        </Modal>
        <Modal
          variant='confirm'
          destructive
          open={dialog.unshareConfirmOpen}
          onOpenChange={(open) => {
            if (!pending) dialog.onUnshareConfirmOpenChange(open)
          }}
          title='Unshare file?'
          description='Are you sure you want to unshare this file? Anyone with the link will lose access.'
          confirmLabel={pending ? 'Unsharing...' : 'Unshare'}
          confirmDisabled={pending}
          onConfirm={() => {
            dialog.onConfirmUnshare()
            return false
          }}
        >
          {failure}
        </Modal>
      </RedesignSurface>
    </div>
  )
}
