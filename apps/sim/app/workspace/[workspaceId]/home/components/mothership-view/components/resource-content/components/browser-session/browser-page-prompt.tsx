'use client'

import { type ReactNode, useEffect, useRef, useState } from 'react'
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
import { BrowserNotice } from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-notice'

/** Keeps a click or keystroke aimed at the page from answering a prompt as it appears. */
const ACTIVATION_DELAY_MS = 500

type RespondToPrompt = (requestId: string, response: BrowserPagePromptResponse) => void

/**
 * False until the prompt has been visible long enough to be read. Hiding it
 * disarms it again, so a prompt shown after waiting behind another dialog
 * starts its delay only once it appears.
 */
function useActivationDelay(visible: boolean): boolean {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!visible) {
      setArmed(false)
      return
    }
    const timer = setTimeout(() => setArmed(true), ACTIVATION_DELAY_MS)
    return () => clearTimeout(timer)
  }, [visible])
  return armed
}

interface PromptModalProps<Prompt extends BrowserPagePrompt> {
  prompt: Prompt
  open: boolean
  onRespond: RespondToPrompt
}

/**
 * A page raised this, so it never takes focus, and signing in takes a click on
 * Sign in: Enter in a field never submits credentials typed for the page.
 */
function HttpAuthPromptModal({ prompt, open, onRespond }: PromptModalProps<BrowserHttpAuthPrompt>) {
  const armed = useActivationDelay(open)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const cancel = () => onRespond(prompt.requestId, { allowed: false })
  const submit = () =>
    onRespond(prompt.requestId, { allowed: true, kind: 'http-auth', username, password })
  return (
    <ChipModal
      open={open}
      onOpenChange={(next) => !next && cancel()}
      srTitle='Sign in'
      size='sm'
      focusOnOpen={false}
    >
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
        defaultAction='dismiss'
        primaryAction={{
          label: 'Sign in',
          onClick: submit,
          disabled: !armed || (!username && !password),
        }}
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
  /** Closing without the Cancel button; defaults to {@link ChoicePromptModalProps.onCancel}. */
  onDismiss?: () => void
  onChoose: (choiceId: string) => void
}

/**
 * Picks one of the page's offered identities. It never takes focus, nothing is
 * chosen up front, Enter dismisses, and Continue waits out the activation delay,
 * so a keystroke meant for the page can never send an identity.
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
  onDismiss = onCancel,
  onChoose,
}: ChoicePromptModalProps) {
  const armed = useActivationDelay(open)
  const [choiceId, setChoiceId] = useState('')
  return (
    <ChipModal
      open={open}
      onOpenChange={(next) => !next && onDismiss()}
      srTitle={title}
      size='sm'
      focusOnOpen={false}
    >
      <ChipModalHeader onClose={onDismiss}>{title}</ChipModalHeader>
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
      onCancel={() => onRespond(prompt.requestId, { allowed: false, remember: true })}
      onDismiss={() => onRespond(prompt.requestId, { allowed: false })}
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
  const armed = useActivationDelay(open)
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

/**
 * The sign-in or app-launch decision the visible page is waiting on. A kind this
 * renderer cannot show, from a newer shell, is refused at once rather than left
 * for the page to wait out.
 */
export function BrowserPagePromptModal({ prompt, open, onRespond }: BrowserPagePromptModalProps) {
  const refusedRequestIdRef = useRef<string | null>(null)
  const Modal =
    prompt && Object.hasOwn(PROMPT_MODALS, prompt.kind)
      ? (PROMPT_MODALS[prompt.kind] as PromptModal)
      : undefined
  const unsupportedRequestId = prompt && !Modal ? prompt.requestId : null

  useEffect(() => {
    if (!unsupportedRequestId || refusedRequestIdRef.current === unsupportedRequestId) return
    refusedRequestIdRef.current = unsupportedRequestId
    onRespond(unsupportedRequestId, { allowed: false })
  }, [unsupportedRequestId, onRespond])

  if (!prompt || !Modal) return null
  return <Modal key={prompt.requestId} prompt={prompt} open={open} onRespond={onRespond} />
}

interface BrowserAppLaunchNoticeBarProps {
  notice: BrowserAppLaunchNotice
  onRespond: RespondToPrompt
}

/** A page's unprompted request to open another app; nothing opens until the user chooses Open. */
export function BrowserAppLaunchNoticeBar({ notice, onRespond }: BrowserAppLaunchNoticeBarProps) {
  const armed = useActivationDelay(true)
  return (
    <BrowserNotice
      message={`${notice.origin} wants to open ${notice.appName}.`}
      actions={
        <>
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
        </>
      }
    />
  )
}
