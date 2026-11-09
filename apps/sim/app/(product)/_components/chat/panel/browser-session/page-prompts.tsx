'use client'

import { useRef, useState } from 'react'
import { Button, IconButton } from '@sim/emcn/button'
import { Checkbox } from '@sim/emcn/checkbox'
import { SelectField, TextField } from '@sim/emcn/field'
import { Modal } from '@sim/emcn/modal'
import { InlineNotice } from '@sim/emcn/status'
import { useActivationDelay, type useBrowserPanel } from '@/platform/lib/data/browser-panel'
import { formatInstantDate } from '@/platform/shared/time'

type BrowserPanel = ReturnType<typeof useBrowserPanel>
type PageDialog = NonNullable<BrowserPanel['dialog']>
type PagePrompt = NonNullable<BrowserPanel['prompt']>
type LaunchNotice = NonNullable<BrowserPanel['launchNotice']>
type Permission = NonNullable<BrowserPanel['permission']>
type RespondToPrompt = BrowserPanel['respondPrompt']
type PromptResponse = Parameters<RespondToPrompt>[1]

/**
 * Answers a page request once. A confirmed dialog closes itself afterward, and that close must not
 * answer the request a second time as a refusal.
 */
function useAnswerOnce<Answer>(
  requestId: string,
  answer: (requestId: string, value: Answer) => void
) {
  const answered = useRef(false)
  return (value: Answer) => {
    if (answered.current) return
    answered.current = true
    answer(requestId, value)
  }
}

interface PageDialogModalProps {
  dialog: PageDialog
  onAnswer: (requestId: string, accept: boolean) => void
}

/** Holds browser-chrome navigation until the reader decides whether to leave their draft. */
export function PageDialogModal({ dialog, onAnswer }: PageDialogModalProps) {
  const answer = useAnswerOnce(dialog.requestId, onAnswer)
  return (
    <Modal
      variant='confirm'
      open
      onOpenChange={(open) => {
        if (!open) answer(false)
      }}
      title='Leave page?'
      description='Changes on this page may not be saved.'
      cancelLabel='Stay'
      confirmLabel='Leave'
      onConfirm={() => answer(true)}
    />
  )
}

interface PermissionModalProps {
  permission: Permission
}

/** A page asking for a device or another website, which the reader allows or blocks. */
export function PermissionModal({ permission }: PermissionModalProps) {
  return (
    <Modal
      variant='confirm'
      open
      onOpenChange={(open) => {
        if (!open) permission.decide(false)
      }}
      title={permission.title}
      description={permission.description}
      cancelLabel='Block'
      confirmLabel='Allow'
      onConfirm={() => permission.decide(true)}
    />
  )
}

interface PromptModalProps<Kind extends PagePrompt['kind']> {
  prompt: Extract<PagePrompt, { kind: Kind }>
  respond: (response: PromptResponse) => void
}

/** Signing in takes a click on Sign in: Enter in a field never submits credentials typed for the page. */
function HttpAuthPrompt({ prompt, respond }: PromptModalProps<'http-auth'>) {
  const armed = useActivationDelay(true)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) respond({ allowed: false })
      }}
      title='Sign in'
      description={`${prompt.proxy ? `The proxy ${prompt.origin}` : prompt.origin} requires a username and password.${prompt.insecure ? ' Your connection to this site is not private.' : ''}`}
      confirmLabel='Sign in'
      confirmDisabled={!armed || (!username && !password)}
      submitOnEnter={false}
      onConfirm={() => respond({ allowed: true, kind: 'http-auth', username, password })}
    >
      <TextField
        label='Username'
        placeholder='Username'
        value={username}
        onChange={setUsername}
        autoComplete='username'
        maxLength={1024}
      />
      <TextField
        label='Password'
        placeholder='Password'
        type='password'
        value={password}
        onChange={setPassword}
        autoComplete='current-password'
        maxLength={1024}
        error={prompt.retry ? 'Incorrect username or password.' : undefined}
      />
    </Modal>
  )
}

interface ChoicePromptProps {
  title: string
  description: string
  fieldLabel: string
  placeholder: string
  options: readonly { value: string; label: string }[]
  hintFor?: (choiceId: string) => string | undefined
  /** A refusal the page should remember, offered beside Cancel. */
  refuse?: { label: string; onSelect: () => void }
  onCancel: () => void
  onChoose: (choiceId: string) => void
}

/**
 * Picks one of the page's offered identities. Nothing is chosen up front and Continue waits out
 * the activation delay, so a keystroke meant for the page can never send an identity.
 */
function ChoicePrompt({
  title,
  description,
  fieldLabel,
  placeholder,
  options,
  hintFor,
  refuse,
  onCancel,
  onChoose,
}: ChoicePromptProps) {
  const armed = useActivationDelay(true)
  const [choiceId, setChoiceId] = useState('')
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
      title={title}
      description={description}
      confirmLabel='Continue'
      confirmDisabled={!armed || !choiceId}
      submitOnEnter={false}
      footerStartAction={refuse ? { label: refuse.label, onClick: refuse.onSelect } : undefined}
      onConfirm={() => onChoose(choiceId)}
    >
      {/* The dialog focuses the closed picker; Enter there dismisses instead of opening it. */}
      <div
        onKeyDownCapture={(event) => {
          const { target } = event
          if (
            event.key !== 'Enter' ||
            event.nativeEvent.isComposing ||
            !(target instanceof HTMLElement) ||
            target.getAttribute('role') !== 'combobox' ||
            target.getAttribute('aria-expanded') === 'true'
          )
            return
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }}
      >
        <SelectField
          label={fieldLabel}
          placeholder={placeholder}
          options={options}
          value={choiceId || undefined}
          onValueChange={setChoiceId}
          hint={choiceId ? hintFor?.(choiceId) : undefined}
        />
      </div>
    </Modal>
  )
}

function PasskeyPrompt({ prompt, respond }: PromptModalProps<'passkey-account'>) {
  return (
    <ChoicePrompt
      title='Sign in with a passkey'
      description={`Choose the account to sign in to ${prompt.relyingPartyId}.`}
      fieldLabel='Account'
      placeholder='Choose an account'
      options={prompt.accounts.map((account) => ({
        value: account.id,
        label:
          account.displayName && account.name && account.displayName !== account.name
            ? `${account.displayName} (${account.name})`
            : account.displayName || account.name || 'Unnamed account',
      }))}
      onCancel={() => respond({ allowed: false })}
      onChoose={(choiceId) => respond({ allowed: true, kind: 'passkey-account', choiceId })}
    />
  )
}

function ClientCertificatePrompt({ prompt, respond }: PromptModalProps<'client-certificate'>) {
  return (
    <ChoicePrompt
      title='Select a certificate'
      description={`${prompt.host} is asking you to identify yourself.`}
      fieldLabel='Certificate'
      placeholder='Choose a certificate'
      options={prompt.certificates.map((certificate) => ({
        value: certificate.id,
        label: certificate.subject || certificate.id,
      }))}
      hintFor={(choiceId) => {
        const chosen = prompt.certificates.find((certificate) => certificate.id === choiceId)
        return chosen
          ? `Issued by ${chosen.issuer || 'unknown issuer'} · Expires ${formatInstantDate(chosen.expiresAt)}`
          : undefined
      }}
      refuse={{
        label: "Don't send",
        onSelect: () => respond({ allowed: false, remember: true }),
      }}
      onCancel={() => respond({ allowed: false })}
      onChoose={(choiceId) => respond({ allowed: true, kind: 'client-certificate', choiceId })}
    />
  )
}

function ExternalAppPrompt({ prompt, respond }: PromptModalProps<'external-app'>) {
  const armed = useActivationDelay(true)
  const [alwaysAllow, setAlwaysAllow] = useState(false)
  return (
    <Modal
      variant='confirm'
      open
      onOpenChange={(open) => {
        if (!open) respond({ allowed: false })
      }}
      title={`Open ${prompt.appName}?`}
      description={`${prompt.origin} wants to open this app.`}
      confirmLabel='Open'
      confirmDisabled={!armed}
      onConfirm={() =>
        respond({
          allowed: true,
          kind: 'external-app',
          alwaysAllow: prompt.canAlwaysAllow && alwaysAllow,
        })
      }
    >
      {prompt.canAlwaysAllow && (
        <Checkbox
          label='Always allow on this site'
          checked={alwaysAllow}
          onCheckedChange={setAlwaysAllow}
        />
      )}
    </Modal>
  )
}

interface PagePromptModalProps {
  prompt: PagePrompt
  onRespond: RespondToPrompt
}

function PagePromptFor({ prompt, onRespond }: PagePromptModalProps) {
  const respond = useAnswerOnce(prompt.requestId, onRespond)
  switch (prompt.kind) {
    case 'http-auth':
      return <HttpAuthPrompt prompt={prompt} respond={respond} />
    case 'passkey-account':
      return <PasskeyPrompt prompt={prompt} respond={respond} />
    case 'client-certificate':
      return <ClientCertificatePrompt prompt={prompt} respond={respond} />
    case 'external-app':
      return <ExternalAppPrompt prompt={prompt} respond={respond} />
  }
}

/** The sign-in or app-launch decision the visible page is waiting on, one request at a time. */
export function PagePromptModal({ prompt, onRespond }: PagePromptModalProps) {
  return <PagePromptFor key={prompt.requestId} prompt={prompt} onRespond={onRespond} />
}

interface AppLaunchNoticeProps {
  notice: LaunchNotice
  onRespond: RespondToPrompt
}

/** A page's unprompted request to open another app; nothing opens until the reader chooses Open. */
export function AppLaunchNotice({ notice, onRespond }: AppLaunchNoticeProps) {
  const armed = useActivationDelay(true)
  const respond = useAnswerOnce(notice.requestId, onRespond)
  return (
    <InlineNotice
      message={`${notice.origin} wants to open ${notice.appName}.`}
      action={
        <>
          <Button
            variant='muted'
            size='compact'
            disabled={!armed}
            onClick={() => respond({ allowed: true, kind: 'app-launch-notice' })}
          >
            Open
          </Button>
          <IconButton
            label={`Don't open ${notice.appName}`}
            icon='I105'
            size='compact'
            onClick={() => respond({ allowed: false })}
          />
        </>
      }
    />
  )
}
