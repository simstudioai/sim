'use client'

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Button,
  Chip,
  ChipDropdown,
  type ChipDropdownOption,
  ChipInput,
  Code,
  CopyCodeButton,
  Label,
  SecretInput,
  Wizard,
} from '@sim/emcn'
import { Loader, Plus, Trash } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { SlackIcon } from '@/components/icons'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  useCreateWorkspaceCredential,
  useUpdateWorkspaceCredential,
} from '@/hooks/queries/credentials'
import {
  buildSlackManifest,
  getSlackManagedUserAuthorizationManifestConfig,
  SLACK_CAPABILITIES,
  SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY,
  type SlackAgentAction,
  type SlackAgentSuggestedPrompt,
} from '@/triggers/slack/capabilities'
import { buildSlackCustomBotRequestUrl } from '@/triggers/webhook-url'

const logger = createLogger('ConnectSlackBotModal')

const DEFAULT_APP_NAME = 'Sim Bot'
const DONE_STEP = 5

/** Every capability is granted by default; trimming is an opt-in dropdown. */
const CUSTOM_BOT_CAPABILITIES = [
  ...SLACK_CAPABILITIES,
  SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY,
] as const

const ALL_CAPABILITIES = new Set(CUSTOM_BOT_CAPABILITIES.map((capability) => capability.id))

const CAPABILITY_OPTIONS: ChipDropdownOption[] = CUSTOM_BOT_CAPABILITIES.map((capability) => ({
  value: capability.id,
  label: capability.label,
}))

interface SlackAgentActionDraft extends SlackAgentAction {
  id: string
}

interface SlackSuggestedPromptDraft extends SlackAgentSuggestedPrompt {
  id: string
}

function getAgentConfigurationError(
  actions: readonly SlackAgentActionDraft[],
  prompts: readonly SlackSuggestedPromptDraft[]
): string | null {
  if (actions.some((action) => !action.name.trim() || !action.description.trim())) {
    return 'Every agent action needs a name and description.'
  }
  if (prompts.some((prompt) => !prompt.title.trim() || !prompt.message.trim())) {
    return 'Every suggested prompt needs a title and message.'
  }
  if (prompts.length > 4) {
    return 'Slack Agent View supports at most four suggested prompts.'
  }
  return null
}

function getAgentDescriptionError(description: string): string | null {
  return description.trim().length > 300
    ? 'Slack Agent View descriptions must be 300 characters or fewer.'
    : null
}

interface ConnectSlackBotModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  /**
   * When set, the modal reconnects (rotates secrets on) this existing credential
   * instead of creating a new one — the id is reused so the Slack ingest URL
   * `/api/webhooks/slack/custom/{id}` stays valid, and saving updates the
   * credential in place.
   */
  credentialId?: string
  /** Existing display name, seeded into the bot-name field on reconnect. */
  initialDisplayName?: string
  /** Existing description, seeded into the description field on reconnect. */
  initialDescription?: string
  /** Called with the credential id after a successful create or reconnect. */
  onCreated?: (credentialId: string) => void
}

/**
 * One-time setup for a reusable custom Slack bot credential — the same guided
 * wizard as the legacy in-block setup, but it persists a workspace credential
 * instead of writing sub-block values. The credential id is pre-generated so the
 * ingest URL `/api/webhooks/slack/custom/{id}` (and the manifest that embeds it)
 * can be shown up front; the credential is created on the final step once the
 * signing secret + bot token are pasted.
 */
export function ConnectSlackBotModal({
  open,
  onOpenChange,
  workspaceId,
  credentialId: reconnectCredentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: ConnectSlackBotModalProps) {
  const isReconnect = Boolean(reconnectCredentialId)
  const [step, setStep] = useState(0)
  const [credentialId, setCredentialId] = useState(() => reconnectCredentialId ?? generateId())
  const [appName, setAppName] = useState(initialDisplayName ?? '')
  const [appDescription, setAppDescription] = useState(initialDescription ?? '')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(ALL_CAPABILITIES))
  const [agentActions, setAgentActions] = useState<SlackAgentActionDraft[]>([])
  const [suggestedPrompts, setSuggestedPrompts] = useState<SlackSuggestedPromptDraft[]>([])
  const [signingSecret, setSigningSecret] = useState('')
  const [botToken, setBotToken] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const createCredential = useCreateWorkspaceCredential()
  const updateCredential = useUpdateWorkspaceCredential()

  useEffect(() => {
    if (open) return
    setStep(0)
    setAppName(initialDisplayName ?? '')
    setAppDescription(initialDescription ?? '')
    setSelected(new Set(ALL_CAPABILITIES))
    setAgentActions([])
    setSuggestedPrompts([])
    setSigningSecret('')
    setBotToken('')
    setCreateError(null)
    // Mint a fresh ingest id only after a bot was actually saved, and never when
    // reconnecting (that id belongs to an existing credential + Slack app).
    // Otherwise keep it stable so a user who already pasted this Request URL into
    // their Slack app can reopen and finish creating the credential under the
    // same id — a regenerated id would leave Slack posting to a URL no credential
    // resolves.
    if (created) {
      if (!isReconnect) setCredentialId(generateId())
      setCreated(false)
    }
  }, [open, created, isReconnect, initialDisplayName, initialDescription])

  // Shared server-side derivation: uses the app public base (not
  // window.location.origin) so Slack's servers can reach it.
  const requestUrl = useMemo(() => buildSlackCustomBotRequestUrl(credentialId), [credentialId])

  const descriptionError = getAgentDescriptionError(appDescription)
  const agentConfigurationError = getAgentConfigurationError(agentActions, suggestedPrompts)
  const manifestConfigurationError = descriptionError ?? agentConfigurationError

  const manifestJson = useMemo(() => {
    if (manifestConfigurationError) return ''
    const managedUserAuthorization = selected.has(SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY.id)
      ? getSlackManagedUserAuthorizationManifestConfig(getBaseUrl())
      : undefined
    const manifest = buildSlackManifest(selected, {
      appName: appName.trim() || DEFAULT_APP_NAME,
      webhookUrl: requestUrl,
      description: appDescription,
      agentActions: agentActions.map(({ name, description }) => ({ name, description })),
      suggestedPrompts: suggestedPrompts.map(({ title, message }) => ({ title, message })),
      ...(managedUserAuthorization ? { managedUserAuthorization } : {}),
    })
    return JSON.stringify(manifest, null, 2)
  }, [
    manifestConfigurationError,
    selected,
    appName,
    appDescription,
    agentActions,
    suggestedPrompts,
    requestUrl,
  ])

  const capabilityIds = useMemo(() => [...selected], [selected])
  const setCapabilityIds = useCallback((next: string[]) => setSelected(new Set(next)), [])

  const isPending = createCredential.isPending || updateCredential.isPending

  const runCreate = useCallback(async () => {
    setCreateError(null)
    try {
      if (isReconnect) {
        // Rotate secrets on the existing credential in place — same id, so the
        // Slack app's Request URL and any shares stay intact.
        await updateCredential.mutateAsync({
          credentialId,
          signingSecret: signingSecret.trim(),
          botToken: botToken.trim(),
          displayName: appName.trim() || undefined,
          description: appDescription.trim() || undefined,
        })
      } else {
        await createCredential.mutateAsync({
          workspaceId,
          type: 'service_account',
          providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
          id: credentialId,
          signingSecret: signingSecret.trim(),
          botToken: botToken.trim(),
          displayName: appName.trim() || undefined,
          description: appDescription.trim() || undefined,
        })
      }
      setCreated(true)
      onCreated?.(credentialId)
    } catch (err: unknown) {
      setCreateError(getErrorMessage(err, 'Could not connect the Slack bot.'))
      logger.error('Failed to add custom Slack bot credential', err)
    }
  }, [
    isReconnect,
    updateCredential,
    createCredential,
    workspaceId,
    credentialId,
    signingSecret,
    botToken,
    appName,
    appDescription,
    onCreated,
  ])

  // Create the credential once when the final step is first reached (reachable
  // only after both secrets are entered). A ref guards against re-firing on
  // failure — retry is manual via the "Try again" button.
  const attemptedRef = useRef(false)
  useEffect(() => {
    if (step !== DONE_STEP) {
      attemptedRef.current = false
      return
    }
    if (attemptedRef.current) return
    attemptedRef.current = true
    void runCreate()
  }, [step, runCreate])

  return (
    <Wizard
      open={open}
      onOpenChange={onOpenChange}
      currentStep={step}
      onStepChange={setStep}
      size='lg'
      icon={SlackIcon}
      title={isReconnect ? 'Reconnect a custom Slack bot' : 'Create a custom Slack bot'}
      doneLabel='Done'
    >
      {/* Bot name is required so the credential name, the manifest app name, and
          uniqueness all use the user's choice — never the shared Slack team name
          fallback, which collides for a second bot in the same workspace. */}
      <Wizard.Step
        title='Configure your bot'
        canAdvance={appName.trim().length > 0 && !descriptionError}
      >
        <StepConfigure
          appName={appName}
          onAppNameChange={setAppName}
          appDescription={appDescription}
          onAppDescriptionChange={setAppDescription}
          descriptionError={descriptionError}
          capabilityIds={capabilityIds}
          onCapabilityIdsChange={setCapabilityIds}
        />
      </Wizard.Step>
      <Wizard.Step title='Customize Agent View' canAdvance={!agentConfigurationError}>
        <StepAgentView
          actions={agentActions}
          onActionsChange={setAgentActions}
          suggestedPrompts={suggestedPrompts}
          onSuggestedPromptsChange={setSuggestedPrompts}
          error={agentConfigurationError}
        />
      </Wizard.Step>
      <Wizard.Step title='Create the app in Slack'>
        <StepCreate manifestJson={manifestJson} />
      </Wizard.Step>
      <Wizard.Step title='Paste your Signing Secret' canAdvance={signingSecret.trim().length > 0}>
        <StepSecret value={signingSecret} onChange={setSigningSecret} />
      </Wizard.Step>
      <Wizard.Step title='Install and paste your Bot Token' canAdvance={botToken.trim().length > 0}>
        <StepToken value={botToken} onChange={setBotToken} />
      </Wizard.Step>
      <Wizard.Step title='All set'>
        <StepDone pending={isPending} created={created} error={createError} onRetry={runCreate} />
      </Wizard.Step>
    </Wizard>
  )
}

interface SubStepListProps {
  children: ReactNode
}
function SubStepList({ children }: SubStepListProps) {
  return <ol className='space-y-2.5'>{children}</ol>
}

interface SubStepProps {
  n: number
  children: ReactNode
}
function SubStep({ n, children }: SubStepProps) {
  return (
    <li className='flex gap-2.5'>
      <span className='mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-5)] text-[var(--text-secondary)] text-xs tabular-nums'>
        {n}
      </span>
      <div className='min-w-0 flex-1 text-[var(--text-secondary)] text-sm leading-relaxed'>
        {children}
      </div>
    </li>
  )
}

interface StepConfigureProps {
  appName: string
  onAppNameChange: (next: string) => void
  appDescription: string
  onAppDescriptionChange: (next: string) => void
  descriptionError: string | null
  capabilityIds: string[]
  onCapabilityIdsChange: (next: string[]) => void
}
function StepConfigure({
  appName,
  onAppNameChange,
  appDescription,
  onAppDescriptionChange,
  descriptionError,
  capabilityIds,
  onCapabilityIdsChange,
}: StepConfigureProps) {
  const allSelected = capabilityIds.length === CUSTOM_BOT_CAPABILITIES.length

  return (
    <div className='space-y-4'>
      <div className='flex flex-col gap-[9px]'>
        <Label htmlFor='slack-bot-name' className='text-[var(--text-muted)] text-small'>
          Bot name
        </Label>
        <ChipInput
          id='slack-bot-name'
          value={appName}
          onChange={(e) => onAppNameChange(e.target.value)}
          placeholder={DEFAULT_APP_NAME}
        />
      </div>
      <div className='flex flex-col gap-[9px]'>
        <Label htmlFor='slack-bot-description' className='text-[var(--text-muted)] text-small'>
          Description
        </Label>
        <ChipInput
          id='slack-bot-description'
          value={appDescription}
          onChange={(e) => onAppDescriptionChange(e.target.value)}
          placeholder="Optional — shown on the bot's Slack profile"
          maxLength={140}
          error={Boolean(descriptionError)}
        />
        {descriptionError && (
          <p className='text-[var(--text-error)] text-caption'>{descriptionError}</p>
        )}
      </div>
      <div className='flex flex-col gap-[9px]'>
        <Label className='text-[var(--text-muted)] text-small'>Additional permissions</Label>
        <ChipDropdown
          multiple
          fullWidth
          value={capabilityIds}
          onChange={onCapabilityIdsChange}
          options={CAPABILITY_OPTIONS}
          allLabel='No additional permissions'
          showAllOption={false}
        />
        {allSelected && (
          <p className='text-[var(--text-muted)] text-caption'>
            All additional permissions enabled — the bot can read messages, react, access files and
            users, and people can authorize it through Credential Groups.
          </p>
        )}
        <p className='text-[var(--text-muted)] text-caption'>
          Agent View, Agent Sessions, streaming, message posting, and direct messages are always
          enabled for custom bots.
        </p>
      </div>
    </div>
  )
}

interface StepAgentViewProps {
  actions: readonly SlackAgentActionDraft[]
  onActionsChange: (actions: SlackAgentActionDraft[]) => void
  suggestedPrompts: readonly SlackSuggestedPromptDraft[]
  onSuggestedPromptsChange: (prompts: SlackSuggestedPromptDraft[]) => void
  error: string | null
}

function StepAgentView({
  actions,
  onActionsChange,
  suggestedPrompts,
  onSuggestedPromptsChange,
  error,
}: StepAgentViewProps) {
  const addAction = () => {
    onActionsChange([...actions, { id: generateId(), name: '', description: '' }])
  }
  const updateAction = (
    id: string,
    field: keyof Pick<SlackAgentActionDraft, 'name' | 'description'>,
    value: string
  ) => {
    onActionsChange(
      actions.map((action) => (action.id === id ? { ...action, [field]: value } : action))
    )
  }
  const removeAction = (id: string) => {
    onActionsChange(actions.filter((action) => action.id !== id))
  }

  const addSuggestedPrompt = () => {
    onSuggestedPromptsChange([...suggestedPrompts, { id: generateId(), title: '', message: '' }])
  }
  const updateSuggestedPrompt = (
    id: string,
    field: keyof Pick<SlackSuggestedPromptDraft, 'title' | 'message'>,
    value: string
  ) => {
    onSuggestedPromptsChange(
      suggestedPrompts.map((prompt) => (prompt.id === id ? { ...prompt, [field]: value } : prompt))
    )
  }
  const removeSuggestedPrompt = (id: string) => {
    onSuggestedPromptsChange(suggestedPrompts.filter((prompt) => prompt.id !== id))
  }

  return (
    <div className='space-y-5'>
      <p className='text-[var(--text-secondary)] text-sm leading-relaxed'>
        Optionally advertise what your agent can do and give people clickable conversation starters.
        Agent actions describe capabilities in Slack; they do not create slash commands or workflow
        handlers.
      </p>

      <div className='space-y-2'>
        <div>
          <Label className='text-[var(--text-muted)] text-small'>Agent actions</Label>
          <p className='text-[var(--text-muted)] text-caption'>
            Short names and descriptions shown in the Agent View capability menu.
          </p>
        </div>
        {actions.map((action, index) => (
          <div
            key={action.id}
            className='flex items-start gap-2 rounded-lg border border-[var(--border-1)] p-2'
          >
            <div className='min-w-0 flex-1 space-y-2'>
              <ChipInput
                value={action.name}
                onChange={(event) => updateAction(action.id, 'name', event.target.value)}
                placeholder='Action name, e.g. Search docs'
                aria-label={`Agent action ${index + 1} name`}
              />
              <ChipInput
                value={action.description}
                onChange={(event) => updateAction(action.id, 'description', event.target.value)}
                placeholder='What this action lets the agent do'
                aria-label={`Agent action ${index + 1} description`}
              />
            </div>
            <Button
              variant='quiet'
              size='icon'
              aria-label={`Remove agent action ${index + 1}`}
              onClick={() => removeAction(action.id)}
            >
              <Trash className='size-[14px]' />
            </Button>
          </div>
        ))}
        <Chip className='w-fit' leftIcon={Plus} onClick={addAction}>
          Add action
        </Chip>
      </div>

      <div className='space-y-2'>
        <div>
          <Label className='text-[var(--text-muted)] text-small'>Suggested prompts</Label>
          <p className='text-[var(--text-muted)] text-caption'>
            Static prompts pinned to the Messages tab. Slack recommends two to four.
          </p>
        </div>
        {suggestedPrompts.map((prompt, index) => (
          <div
            key={prompt.id}
            className='flex items-start gap-2 rounded-lg border border-[var(--border-1)] p-2'
          >
            <div className='min-w-0 flex-1 space-y-2'>
              <ChipInput
                value={prompt.title}
                onChange={(event) => updateSuggestedPrompt(prompt.id, 'title', event.target.value)}
                placeholder='Prompt title, e.g. Reset password'
                aria-label={`Suggested prompt ${index + 1} title`}
              />
              <ChipInput
                value={prompt.message}
                onChange={(event) =>
                  updateSuggestedPrompt(prompt.id, 'message', event.target.value)
                }
                placeholder='Message sent when someone chooses this prompt'
                aria-label={`Suggested prompt ${index + 1} message`}
              />
            </div>
            <Button
              variant='quiet'
              size='icon'
              aria-label={`Remove suggested prompt ${index + 1}`}
              onClick={() => removeSuggestedPrompt(prompt.id)}
            >
              <Trash className='size-[14px]' />
            </Button>
          </div>
        ))}
        <Chip
          className='w-fit'
          leftIcon={Plus}
          onClick={addSuggestedPrompt}
          disabled={suggestedPrompts.length >= 4}
        >
          Add suggested prompt
        </Chip>
      </div>

      {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
    </div>
  )
}

interface StepCreateProps {
  manifestJson: string
}
function StepCreate({ manifestJson }: StepCreateProps) {
  return (
    <div className='space-y-4'>
      <SubStepList>
        <SubStep n={1}>
          <div>Copy your manifest:</div>
          <div className='mt-2 overflow-hidden rounded-md border border-[var(--border-1)]'>
            <div className='flex items-center justify-between border-[var(--border-1)] border-b bg-[var(--surface-4)] px-3 py-1'>
              <span className='font-sans text-[var(--text-tertiary)] text-xs'>manifest.json</span>
              <CopyCodeButton
                code={manifestJson}
                className='text-[var(--text-tertiary)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-secondary)]'
              />
            </div>
            <Code.Viewer code={manifestJson} language='json' wrapText className='max-h-[180px]' />
          </div>
        </SubStep>
        <SubStep n={2}>
          Open the{' '}
          <a
            href='https://api.slack.com/apps'
            target='_blank'
            rel='noopener noreferrer'
            className='text-[var(--brand-secondary)] underline underline-offset-2'
          >
            Slack Apps page
          </a>
          .
        </SubStep>
        <SubStep n={3}>
          Click <strong>Create New App</strong> → <strong>From a manifest</strong> and pick your
          workspace.
        </SubStep>
        <SubStep n={4}>
          Paste your manifest, then click <strong>Next</strong> → <strong>Create</strong>.
        </SubStep>
      </SubStepList>
    </div>
  )
}

interface SecretStepProps {
  value: string
  onChange: (next: string) => void
}
function StepSecret({ value, onChange }: SecretStepProps) {
  return (
    <div className='space-y-4'>
      <SubStepList>
        <SubStep n={1}>
          In your new Slack app, open <strong>Basic Information</strong>.
        </SubStep>
        <SubStep n={2}>
          Find <strong>Signing Secret</strong> and click <strong>Show</strong>, then copy it.
        </SubStep>
        <SubStep n={3}>Paste it into the field below.</SubStep>
      </SubStepList>
      <SecretField
        label='Signing Secret'
        value={value}
        onChange={onChange}
        placeholder='Paste your signing secret'
      />
    </div>
  )
}

function StepToken({ value, onChange }: SecretStepProps) {
  return (
    <div className='space-y-4'>
      <SubStepList>
        <SubStep n={1}>
          In Slack, open <strong>Install App</strong> → <strong>Install to Workspace</strong> and
          authorize.
        </SubStep>
        <SubStep n={2}>
          Copy the <strong>Bot User OAuth Token</strong> (starts with <code>xoxb-</code>).
        </SubStep>
        <SubStep n={3}>Paste it into the field below, then click Next.</SubStep>
      </SubStepList>
      <SecretField label='Bot Token' value={value} onChange={onChange} placeholder='xoxb-...' />
    </div>
  )
}

interface SecretFieldProps {
  label: string
  value: string
  onChange: (next: string) => void
  placeholder?: string
}
function SecretField({ label, value, onChange, placeholder }: SecretFieldProps) {
  return (
    <div className='flex flex-col gap-[9px]'>
      <Label className='text-[var(--text-muted)] text-small'>{label}</Label>
      <SecretInput value={value} onChange={onChange} placeholder={placeholder} />
    </div>
  )
}

interface StepDoneProps {
  pending: boolean
  created: boolean
  error: string | null
  onRetry: () => void
}
function StepDone({ pending, created, error, onRetry }: StepDoneProps) {
  if (pending) {
    return (
      <div className='flex flex-col items-center gap-3 py-10 text-center'>
        <Loader className='size-6 animate-spin text-[var(--text-muted)]' />
        <p className='text-[var(--text-secondary)] text-sm'>Verifying your bot and connecting…</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className='flex flex-col items-center gap-3 py-10 text-center'>
        <p className='max-w-sm text-[var(--text-error)] text-sm leading-relaxed'>{error}</p>
        <Button variant='default' onClick={onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  if (created) {
    return (
      <div className='flex flex-col items-center gap-4 py-10 text-center'>
        <div className='space-y-1'>
          <p className='text-[var(--text-primary)] text-base'>Bot connected</p>
          <p className='max-w-sm text-[var(--text-secondary)] text-sm leading-relaxed'>
            It's now selectable in Slack triggers and actions across this workspace. Click Done to
            finish.
          </p>
        </div>
      </div>
    )
  }
  return null
}
