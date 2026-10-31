'use client'

import { type ReactNode, useEffect, useState } from 'react'
import type {
  BrowserAppLaunchNotice,
  BrowserClientCertificatePrompt,
  BrowserExternalAppPrompt,
  BrowserHttpAuthPrompt,
  BrowserPagePrompt,
  BrowserPagePromptResponse,
  BrowserPasskeyPrompt,
} from '@sim/browser-protocol'
import {
  Banner,
  Checkbox,
  Chip,
  ChipConfirmModal,
  ChipModal,
  ChipModalBody,
  ChipModalDescription,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
  ChipSelect,
  type ChipSelectOption,
  Label,
} from '@sim/emcn'
import { X } from '@sim/emcn/icons'

/** Keeps a click or keystroke aimed at the page from answering a prompt as it appears. */
const ACTIVATION_DELAY_MS = 500

type RespondToPrompt = (requestId: string, response: BrowserPagePromptResponse) => void

/** False until the prompt has been on screen long enough to be read; remount per request. */
function useActivationDelay(): boolean {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setArmed(true), ACTIVATION_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  return armed
}

interface PromptModalProps<Prompt extends BrowserPagePrompt> {
  prompt: Prompt
  open: boolean
  onRespond: RespondToPrompt
}

function HttpAuthPromptModal({ prompt, open, onRespond }: PromptModalProps<BrowserHttpAuthPrompt>) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const cancel = () => onRespond(prompt.requestId, { allowed: false })
  const submit = () =>
    onRespond(prompt.requestId, { allowed: true, kind: 'http-auth', username, password })
  return (
    <ChipModal open={open} onOpenChange={(next) => !next && cancel()} srTitle='Sign in' size='sm'>
      <ChipModalHeader onClose={cancel}>Sign in</ChipModalHeader>
      <ChipModalBody>
        <ChipModalDescription>
          {prompt.proxy ? `The proxy ${prompt.origin}` : prompt.origin} requires a username and
          password.{prompt.insecure ? ' Your connection to this site is not private.' : ''}
        </ChipModalDescription>
        <ChipModalField
          type='input'
          title='Username'
          value={username}
          onChange={setUsername}
          autoComplete='username'
          maxLength={1024}
        />
        <ChipModalField
          type='input'
          inputType='password'
          title='Password'
          value={password}
          onChange={setPassword}
          autoComplete='current-password'
          maxLength={1024}
          error={prompt.retry ? 'Incorrect username or password.' : undefined}
        />
      </ChipModalBody>
      <ChipModalFooter
        onCancel={cancel}
        primaryAction={{ label: 'Sign in', onClick: submit, disabled: !username && !password }}
      />
    </ChipModal>
  )
}

interface ChoicePromptModalProps {
  open: boolean
  title: string
  description: string
  fieldTitle: string
  placeholder: string
  options: ChipSelectOption[]
  hintFor?: (choiceId: string) => string | undefined
  cancelLabel?: string
  onCancel: () => void
  onChoose: (choiceId: string) => void
}

/**
 * Picks one of the page's offered identities. Nothing is chosen up front, Enter
 * dismisses, and Continue waits out the activation delay, so a keystroke meant
 * for the page can never send an identity.
 */
function ChoicePromptModal({
  open,
  title,
  description,
  fieldTitle,
  placeholder,
  options,
  hintFor,
  cancelLabel,
  onCancel,
  onChoose,
}: ChoicePromptModalProps) {
  const armed = useActivationDelay()
  const [choiceId, setChoiceId] = useState('')
  return (
    <ChipModal open={open} onOpenChange={(next) => !next && onCancel()} srTitle={title} size='sm'>
      <ChipModalHeader onClose={onCancel}>{title}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalDescription>{description}</ChipModalDescription>
        <ChipModalField
          type='custom'
          title={fieldTitle}
          hint={choiceId ? hintFor?.(choiceId) : undefined}
          submitOnEnter={false}
        >
          <ChipSelect
            options={options}
            value={choiceId || undefined}
            onChange={setChoiceId}
            placeholder={placeholder}
            fullWidth
            dropdownWidth='trigger'
            align='start'
          />
        </ChipModalField>
      </ChipModalBody>
      <ChipModalFooter
        cancelLabel={cancelLabel}
        onCancel={onCancel}
        defaultAction='dismiss'
        primaryAction={{
          label: 'Continue',
          onClick: () => onChoose(choiceId),
          disabled: !armed || !choiceId,
        }}
      />
    </ChipModal>
  )
}

function passkeyAccountLabel(account: BrowserPasskeyPrompt['accounts'][number]): string {
  const { displayName, name } = account
  if (displayName && name && displayName !== name) return `${displayName} (${name})`
  return displayName || name || 'Unnamed account'
}

function PasskeyPromptModal({ prompt, open, onRespond }: PromptModalProps<BrowserPasskeyPrompt>) {
  return (
    <ChoicePromptModal
      open={open}
      title='Sign in with a passkey'
      description={`Choose the account to sign in to ${prompt.relyingPartyId}.`}
      fieldTitle='Account'
      placeholder='Choose an account'
      options={prompt.accounts.map((account) => ({
        label: passkeyAccountLabel(account),
        value: account.id,
      }))}
      onCancel={() => onRespond(prompt.requestId, { allowed: false })}
      onChoose={(choiceId) =>
        onRespond(prompt.requestId, { allowed: true, kind: 'passkey-account', choiceId })
      }
    />
  )
}

function ClientCertificatePromptModal({
  prompt,
  open,
  onRespond,
}: PromptModalProps<BrowserClientCertificatePrompt>) {
  const hintFor = (choiceId: string) => {
    const chosen = prompt.certificates.find((certificate) => certificate.id === choiceId)
    if (!chosen) return undefined
    return `Issued by ${chosen.issuer || 'unknown issuer'} · Expires ${new Date(chosen.expiresAt).toLocaleDateString()}`
  }
  return (
    <ChoicePromptModal
      open={open}
      title='Select a certificate'
      description={`${prompt.host} is asking you to identify yourself.`}
      fieldTitle='Certificate'
      placeholder='Choose a certificate'
      options={prompt.certificates.map((certificate) => ({
        label: certificate.subject || certificate.id,
        value: certificate.id,
      }))}
      hintFor={hintFor}
      cancelLabel="Don't send"
      onCancel={() => onRespond(prompt.requestId, { allowed: false })}
      onChoose={(choiceId) =>
        onRespond(prompt.requestId, { allowed: true, kind: 'client-certificate', choiceId })
      }
    />
  )
}

function ExternalAppPromptModal({
  prompt,
  open,
  onRespond,
}: PromptModalProps<BrowserExternalAppPrompt>) {
  const armed = useActivationDelay()
  const [alwaysAllow, setAlwaysAllow] = useState(false)
  const checkboxId = `browser-always-open-${prompt.requestId}`
  return (
    <ChipConfirmModal
      open={open}
      onOpenChange={(next) => !next && onRespond(prompt.requestId, { allowed: false })}
      title={`Open ${prompt.appName}?`}
      text={[{ text: prompt.origin, bold: true }, ' wants to open this app.']}
      defaultAction='dismiss'
      confirm={{
        label: 'Open',
        variant: 'primary',
        disabled: !armed,
        onClick: () =>
          onRespond(prompt.requestId, {
            allowed: true,
            kind: 'external-app',
            alwaysAllow: prompt.canAlwaysAllow && alwaysAllow,
          }),
      }}
    >
      {prompt.canAlwaysAllow && (
        <div className='flex items-center gap-2 px-2'>
          <Checkbox
            id={checkboxId}
            checked={alwaysAllow}
            onCheckedChange={(checked) => setAlwaysAllow(checked === true)}
          />
          <Label htmlFor={checkboxId}>Always allow on this site</Label>
        </div>
      )}
    </ChipConfirmModal>
  )
}

type PromptModal = (props: PromptModalProps<BrowserPagePrompt>) => ReactNode

const PROMPT_MODALS: {
  [Kind in BrowserPagePrompt['kind']]: (
    props: PromptModalProps<Extract<BrowserPagePrompt, { kind: Kind }>>
  ) => ReactNode
} = {
  'http-auth': HttpAuthPromptModal,
  'passkey-account': PasskeyPromptModal,
  'client-certificate': ClientCertificatePromptModal,
  'external-app': ExternalAppPromptModal,
}

interface BrowserPagePromptModalProps {
  prompt: BrowserPagePrompt | undefined
  open: boolean
  onRespond: RespondToPrompt
}

/** The sign-in or app-launch decision the visible page is waiting on. */
export function BrowserPagePromptModal({ prompt, open, onRespond }: BrowserPagePromptModalProps) {
  if (!prompt) return null
  const Modal = PROMPT_MODALS[prompt.kind] as PromptModal | undefined
  if (!Modal) return null
  return <Modal key={prompt.requestId} prompt={prompt} open={open} onRespond={onRespond} />
}

interface BrowserAppLaunchNoticeBarProps {
  notice: BrowserAppLaunchNotice
  onRespond: RespondToPrompt
}

/** A page's unprompted request to open another app; nothing opens until the user chooses Open. */
export function BrowserAppLaunchNoticeBar({ notice, onRespond }: BrowserAppLaunchNoticeBarProps) {
  const armed = useActivationDelay()
  return (
    <Banner className='border-[var(--border)] border-t bg-[var(--surface-3)] px-3 py-1.5'>
      <div className='flex items-center justify-between gap-3'>
        <p className='min-w-0 text-[var(--text-secondary)] text-small'>
          {notice.origin} wants to open {notice.appName}.
        </p>
        <div className='flex shrink-0 items-center gap-0.5'>
          <Chip
            disabled={!armed}
            onClick={() =>
              onRespond(notice.requestId, { allowed: true, kind: 'app-launch-notice' })
            }
          >
            Open
          </Chip>
          <Chip
            leftIcon={X}
            aria-label={`Don't open ${notice.appName}`}
            onClick={() => onRespond(notice.requestId, { allowed: false })}
          />
        </div>
      </div>
    </Banner>
  )
}
