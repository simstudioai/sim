'use client'

import { useId, useState } from 'react'
import { IconButton } from '@sim/emcn/button'
import { CopyButton } from '@sim/emcn/button/copy-button'
import { FieldFrame, fieldDescription, TextAreaField, TextField } from '@sim/emcn/field'
import { Input } from '@sim/emcn/field/inputs'
import { Icon } from '@sim/emcn/icon'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { InlineNotice, Spinner } from '@sim/emcn/status'
import { Switch } from '@sim/emcn/switch'
import { RecipientField } from '@sim/emcn-platform/workspace-fields'
import { randomInt } from '@sim/utils/random'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/chat-tab/chat-tab.module.css'
import type { ChatDeployForm } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/chat-tab/use-chat-deploy'
import { OutputPicker } from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/deploy/output-picker/output-picker'
import {
  type AuthType,
  buildChatDeploymentUrl,
  getPasswordHelperText,
  useRevealChatPassword,
  validateAllowlistEntry,
} from '@/platform/lib/data/workflow-deploy'

const AUTH_LABELS: Record<AuthType, string> = {
  public: 'Public',
  password: 'Password',
  email: 'Email',
  sso: 'SSO',
}

const PASSWORD_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='
const GENERATED_PASSWORD_LENGTH = 24

/** An email address, or a whole domain written as `@example.com`. */
function isAllowedEntry(entry: string) {
  return validateAllowlistEntry(entry) === null
}

function generatePassword(): string {
  let password = ''
  for (let index = 0; index < GENERATED_PASSWORD_LENGTH; index++)
    password += PASSWORD_ALPHABET.charAt(randomInt(0, PASSWORD_ALPHABET.length))
  return password
}

interface ChatTabProps {
  workflowId: string
  chat: ChatDeployForm
  canRevealPassword: boolean
}

/** The Chat tab: where the chat lives, what it answers with and who may open it. */
export function ChatTab({ workflowId, chat, canRevealPassword }: ChatTabProps) {
  const { form, update, errors, identifier, submitting } = chat
  const url = buildChatDeploymentUrl(form.identifier || 'my-chat')
  const displayUrl = url.replace(/^https?:\/\//, '')
  return (
    <div className={styles.form}>
      {errors.general && <InlineNotice intent='danger' message={errors.general} />}
      <IdentifierField
        value={form.identifier}
        onChange={(value) => update('identifier', value.toLowerCase())}
        originalIdentifier={chat.originalIdentifier}
        isChecking={identifier.isChecking}
        isAvailable={identifier.isValid}
        error={errors.identifier ?? identifier.error ?? undefined}
        hint={chat.chatExists && form.identifier ? `Live at ${displayUrl}` : displayUrl}
        liveUrl={chat.chatExists && form.identifier ? url : undefined}
        disabled={submitting}
      />
      <TextField
        label='Title'
        placeholder='Customer Support Assistant'
        value={form.title}
        onChange={(value) => update('title', value)}
        error={errors.title}
        required
        disabled={submitting}
      />
      <OutputPicker
        workflowId={workflowId}
        label='Output'
        value={form.selectedOutputBlocks}
        onValueChange={(values) => update('selectedOutputBlocks', values)}
        valueMode='id'
        placeholder='Select which block outputs to use'
        disabled={submitting}
        error={errors.outputBlocks}
      />
      <SwitchRow
        label='Include thinking'
        checked={form.includeThinking}
        disabled={submitting}
        onCheckedChange={(checked) => update('includeThinking', checked)}
      />
      <SwitchRow
        label='Include tool calls'
        checked={form.includeToolCalls}
        disabled={submitting}
        onCheckedChange={(checked) => update('includeToolCalls', checked)}
      />
      <FieldFrame label='Access control'>
        <SegmentedControl
          label='Chat access'
          options={chat.authOptions.map((type) => ({
            value: type,
            label: AUTH_LABELS[type],
            disabled: submitting,
          }))}
          value={form.authType}
          onSelect={(type) => update('authType', type)}
          holdOnReselect
        />
      </FieldFrame>
      {form.authType === 'password' && (
        <PasswordField
          value={form.password}
          onChange={(value) => update('password', value)}
          keepsCurrent={chat.existingPassword}
          chatId={chat.chatId}
          canReveal={canRevealPassword}
          error={errors.password}
          disabled={submitting}
        />
      )}
      {(form.authType === 'email' || form.authType === 'sso') && (
        <RecipientField
          label={form.authType === 'email' ? 'Allowed emails' : 'Allowed SSO emails'}
          placeholder='Enter emails or domains'
          recipients={form.emails.map((address) => ({
            address,
            invalid: !isAllowedEntry(address),
          }))}
          onRecipientsChange={(recipients) =>
            update(
              'emails',
              recipients.map(({ address }) => address)
            )
          }
          validate={isAllowedEntry}
          error={errors.emails}
          hint='An email address, or a domain such as @example.com.'
          disabled={submitting}
        />
      )}
      <TextAreaField
        label='Welcome message'
        placeholder='Enter a welcome message for your chat'
        value={form.welcomeMessage}
        onChange={(value) => update('welcomeMessage', value)}
        hint='Shown when someone first opens the chat.'
        disabled={submitting}
      />
    </div>
  )
}

interface IdentifierFieldProps {
  value: string
  onChange: (value: string) => void
  originalIdentifier?: string
  isChecking: boolean
  isAvailable: boolean
  error?: string
  hint: string
  liveUrl?: string
  disabled: boolean
}

/** The chat's path, checked for availability as it is typed, with the address it will answer on. */
function IdentifierField({
  value,
  onChange,
  originalIdentifier,
  isChecking,
  isAvailable,
  error,
  hint,
  liveUrl,
  disabled,
}: IdentifierFieldProps) {
  const id = useId()
  const available = isAvailable && Boolean(value) && value !== originalIdentifier
  return (
    <FieldFrame id={id} label='URL' error={error} hint={hint}>
      <Input
        id={id}
        label='URL'
        placeholder='my-chat'
        value={value}
        onChange={onChange}
        required
        autoComplete='off'
        spellCheck={false}
        disabled={disabled}
        invalid={Boolean(error)}
        describedBy={fieldDescription(id, error, hint)}
        trailing={
          isChecking ? (
            <span className={styles.status}>
              <Spinner />
              <span data-visually-hidden=''>Checking availability</span>
            </span>
          ) : available ? (
            <span className={styles.available}>
              <Icon name='I072' label='Name is available' />
            </span>
          ) : liveUrl ? (
            <IconButton
              label='Open chat'
              icon='I037'
              size='compact'
              tooltip
              onClick={() => window.open(liveUrl, '_blank', 'noopener,noreferrer')}
            />
          ) : undefined
        }
      />
    </FieldFrame>
  )
}

interface SwitchRowProps {
  label: string
  checked: boolean
  disabled: boolean
  onCheckedChange: (checked: boolean) => void
}

/** A setting that applies to the chat as it is saved, captioned on its leading edge. */
function SwitchRow({ label, checked, disabled, onCheckedChange }: SwitchRowProps) {
  const id = useId()
  return (
    <div className={styles.switchRow}>
      <label htmlFor={id} data-type='T059'>
        {label}
      </label>
      <Switch
        id={id}
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  )
}

interface PasswordFieldProps {
  value: string
  onChange: (value: string) => void
  /** A password is already saved, so a blank field keeps it. */
  keepsCurrent: boolean
  chatId: string | null
  canReveal: boolean
  error?: string
  disabled: boolean
}

/** The chat password: typed or generated, and the saved one revealed on request for admins. */
function PasswordField({
  value,
  onChange,
  keepsCurrent,
  chatId,
  canReveal,
  error,
  disabled,
}: PasswordFieldProps) {
  const id = useId()
  const reveal = useRevealChatPassword()
  const [revealed, setRevealed] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const shown = current ?? value
  const fetchesCurrent = canReveal && Boolean(chatId) && keepsCurrent
  const hint = getPasswordHelperText(keepsCurrent)
  const fieldError =
    error ?? (canReveal && reveal.isError ? 'Failed to load the current password' : undefined)

  const change = (next: string) => {
    if (reveal.isError) reveal.reset()
    setCurrent(null)
    onChange(next)
  }

  const toggleReveal = async () => {
    if (revealed) {
      // The fetched password is dropped, not masked, so the plaintext leaves the field's value.
      setRevealed(false)
      setCurrent(null)
      return
    }
    if (!shown && fetchesCurrent && chatId) {
      try {
        setCurrent(await reveal.mutateAsync({ chatId }))
      } catch {
        return
      }
    }
    setRevealed(true)
  }

  return (
    <FieldFrame id={id} label='Password' error={fieldError} hint={hint}>
      <Input
        id={id}
        label='Password'
        type={revealed ? 'text' : 'password'}
        value={shown}
        onChange={change}
        placeholder={keepsCurrent ? '••••••••' : 'Enter password'}
        required={!keepsCurrent}
        autoComplete='new-password'
        spellCheck={false}
        disabled={disabled}
        invalid={Boolean(fieldError)}
        describedBy={fieldDescription(id, fieldError, hint)}
        trailing={
          <>
            <IconButton
              label='Generate password'
              icon='I065'
              size='compact'
              tooltip
              disabled={disabled}
              onClick={() => {
                change(generatePassword())
                setRevealed(true)
              }}
            />
            {shown && <CopyButton label='Copy password' text={shown} size='compact' />}
            <IconButton
              label={revealed ? 'Hide password' : 'Show password'}
              icon={revealed ? 'eye-off' : 'eye'}
              size='compact'
              tooltip
              disabled={disabled || reveal.isPending}
              onClick={() => void toggleReveal()}
            />
          </>
        }
      />
    </FieldFrame>
  )
}
