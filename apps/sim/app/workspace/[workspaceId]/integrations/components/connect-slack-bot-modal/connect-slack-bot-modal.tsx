'use client'

import { type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Chip,
  ChipDropdown,
  type ChipDropdownOption,
  ChipInput,
  ChipModalField,
  Code,
  CopyCodeButton,
  SecretInput,
  Wizard,
} from '@sim/emcn'
import { Loader, Plus, Trash } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { SlackIcon } from '@/components/icons'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  SLACK_MANAGED_USER_SCOPES,
  SLACK_SEARCH_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import {
  useCreateScopedCredential,
  useUpdateScopedCredential,
} from '@/hooks/queries/scoped-credentials'
import {
  buildSlackManifest,
  getSlackManagedUserAuthorizationManifestConfig,
  SLACK_CAPABILITIES,
  SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY,
  type SlackSlashCommand,
} from '@/triggers/slack/capabilities'
import { buildSlackCustomBotRequestUrl } from '@/triggers/webhook-url'

const logger = createLogger('ConnectSlackBotModal')

const DEFAULT_APP_NAME = 'Sim Bot'
const DONE_STEP = 4

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

interface SlackSlashCommandDraft extends SlackSlashCommand {
  id: string
}

function getSlashCommandsError(commands: readonly SlackSlashCommandDraft[]): string | null {
  if (commands.some((entry) => !entry.command.trim() || !entry.description.trim())) {
    return 'Every slash command needs a command and description.'
  }
  if (
    commands.some((entry) => {
      const command = entry.command.trim()
      return !command.startsWith('/') || command.length === 1 || /\s/.test(command)
    })
  ) {
    return 'Slash commands must be one word beginning with /.'
  }
  if (commands.some((entry) => entry.command.trim().length > 32)) {
    return 'Slash commands must be 32 characters or fewer.'
  }
  const normalizedCommands = commands.map((entry) => entry.command.trim())
  if (new Set(normalizedCommands).size !== normalizedCommands.length) {
    return 'Each slash command must be unique.'
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
  workspaceId?: string
  organizationId?: string
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
 * wizard as the legacy in-block setup, but it persists a scoped credential
 * instead of writing sub-block values. The credential id is pre-generated so the
 * ingest URL `/api/webhooks/slack/custom/{id}` (and the manifest that embeds it)
 * can be shown up front; the credential is created on the final step once the
 * signing secret + bot token are pasted.
 */
export function ConnectSlackBotModal({
  open,
  onOpenChange,
  workspaceId,
  organizationId,
  credentialId: reconnectCredentialId,
  initialDisplayName,
  initialDescription,
  onCreated,
}: ConnectSlackBotModalProps) {
  const scope = resourceScopeFromOwner({ workspaceId, organizationId })
  const searchOnly = scope.kind === 'organization'
  const isReconnect = Boolean(reconnectCredentialId)
  const [step, setStep] = useState(0)
  const [credentialId, setCredentialId] = useState(() => reconnectCredentialId ?? generateId())
  const [appName, setAppName] = useState(initialDisplayName ?? '')
  const [appDescription, setAppDescription] = useState(initialDescription ?? '')
  const [selected, setSelected] = useState<Set<string>>(() => new Set(ALL_CAPABILITIES))
  const [memberAccess, setMemberAccess] = useState<'search' | 'workflow'>(
    isReconnect ? 'workflow' : 'search'
  )
  const [slashCommands, setSlashCommands] = useState<SlackSlashCommandDraft[]>([])
  const [signingSecret, setSigningSecret] = useState('')
  const [botToken, setBotToken] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState(false)

  const createCredential = useCreateScopedCredential()
  const updateCredential = useUpdateScopedCredential()

  useEffect(() => {
    if (open) return
    setStep(0)
    setAppName(initialDisplayName ?? '')
    setAppDescription(initialDescription ?? '')
    setSelected(new Set(ALL_CAPABILITIES))
    setMemberAccess(isReconnect ? 'workflow' : 'search')
    setSlashCommands([])
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
  const requestUrl = buildSlackCustomBotRequestUrl(credentialId)

  const descriptionError = getAgentDescriptionError(appDescription)
  const slashCommandsError = searchOnly ? null : getSlashCommandsError(slashCommands)
  const manifestConfigurationError = descriptionError ?? slashCommandsError

  const manifestJson = useMemo(() => {
    if (manifestConfigurationError) return ''
    const capabilities = searchOnly ? ALL_CAPABILITIES : selected
    const managedUserAuthorization = capabilities.has(
      SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY.id
    )
      ? getSlackManagedUserAuthorizationManifestConfig(
          getBaseUrl(),
          searchOnly || memberAccess === 'search'
            ? SLACK_SEARCH_USER_SCOPES
            : SLACK_MANAGED_USER_SCOPES
        )
      : undefined
    const manifest = buildSlackManifest(capabilities, {
      appName: appName.trim() || DEFAULT_APP_NAME,
      webhookUrl: requestUrl,
      description: appDescription,
      slashCommands: (searchOnly ? [] : slashCommands).map(
        ({ command, description, usageHint }) => ({
          command,
          description,
          usageHint,
        })
      ),
      ...(managedUserAuthorization ? { managedUserAuthorization } : {}),
    })
    return JSON.stringify(manifest, null, 2)
  }, [
    manifestConfigurationError,
    selected,
    appName,
    appDescription,
    slashCommands,
    requestUrl,
    memberAccess,
    searchOnly,
  ])

  const capabilityIds = [...selected]
  const setCapabilityIds = (next: string[]) => setSelected(new Set(next))

  const isPending = createCredential.isPending || updateCredential.isPending

  const runCreate = async () => {
    setCreateError(null)
    try {
      if (isReconnect) {
        // Rotate secrets on the existing credential in place — same id, so the
        // Slack app's Request URL and any shares stay intact.
        await updateCredential.mutateAsync({
          ...resourceScopeFields(scope),
          credentialId,
          signingSecret: signingSecret.trim(),
          botToken: botToken.trim(),
          displayName: appName.trim() || undefined,
          description: appDescription.trim() || undefined,
        })
      } else {
        await createCredential.mutateAsync({
          ...resourceScopeFields(scope),
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
  }

  const handleStepChange = (nextStep: number) => {
    setStep(nextStep)
    if (nextStep === DONE_STEP && step !== DONE_STEP) void runCreate()
  }

  return (
    <Wizard
      open={open}
      onOpenChange={onOpenChange}
      currentStep={step}
      onStepChange={handleStepChange}
      size='lg'
      icon={SlackIcon}
      title={
        searchOnly
          ? 'Set up Slack for search'
          : isReconnect
            ? 'Reconnect a custom Slack bot'
            : 'Create a custom Slack bot'
      }
      doneLabel='Done'
    >
      {/* Bot name is required so the credential name, the manifest app name, and
          uniqueness all use the user's choice — never the shared Slack team name
          fallback, which collides for a second bot in the same workspace. */}
      <Wizard.Step
        title={searchOnly ? 'Name your Slack app' : 'Configure your bot'}
        canAdvance={appName.trim().length > 0 && !descriptionError && !slashCommandsError}
      >
        <StepConfigure
          searchOnly={searchOnly}
          appName={appName}
          onAppNameChange={setAppName}
          appDescription={appDescription}
          onAppDescriptionChange={setAppDescription}
          descriptionError={descriptionError}
          slashCommands={slashCommands}
          onSlashCommandsChange={setSlashCommands}
          slashCommandsError={slashCommandsError}
          capabilityIds={capabilityIds}
          onCapabilityIdsChange={setCapabilityIds}
          memberAccess={memberAccess}
          onMemberAccessChange={setMemberAccess}
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
        <StepDone
          searchOnly={searchOnly}
          pending={isPending}
          created={created}
          error={createError}
          onRetry={runCreate}
        />
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
  searchOnly: boolean
  appName: string
  onAppNameChange: (next: string) => void
  appDescription: string
  onAppDescriptionChange: (next: string) => void
  descriptionError: string | null
  slashCommands: readonly SlackSlashCommandDraft[]
  onSlashCommandsChange: (commands: SlackSlashCommandDraft[]) => void
  slashCommandsError: string | null
  capabilityIds: string[]
  onCapabilityIdsChange: (next: string[]) => void
  memberAccess: 'search' | 'workflow'
  onMemberAccessChange: (access: 'search' | 'workflow') => void
}
function StepConfigure({
  searchOnly,
  appName,
  onAppNameChange,
  appDescription,
  onAppDescriptionChange,
  descriptionError,
  slashCommands,
  onSlashCommandsChange,
  slashCommandsError,
  capabilityIds,
  onCapabilityIdsChange,
  memberAccess,
  onMemberAccessChange,
}: StepConfigureProps) {
  const allSelected = capabilityIds.length === CUSTOM_BOT_CAPABILITIES.length

  return (
    <>
      <ChipModalField
        type='input'
        title={searchOnly ? 'App name' : 'Bot name'}
        value={appName}
        onChange={onAppNameChange}
        placeholder={DEFAULT_APP_NAME}
      />
      <ChipModalField
        type='input'
        title='Description'
        value={appDescription}
        onChange={onAppDescriptionChange}
        placeholder="Optional — shown on the bot's Slack profile"
        maxLength={140}
        error={descriptionError}
      />
      {!searchOnly && (
        <ChipModalField
          type='custom'
          title='Additional permissions'
          hint={
            allSelected
              ? 'All additional permissions enabled — the bot can read messages, react, access files and users, and people can authorize it through Connected accounts.'
              : undefined
          }
        >
          <ChipDropdown
            multiple
            fullWidth
            value={capabilityIds}
            onChange={onCapabilityIdsChange}
            options={CAPABILITY_OPTIONS}
            allLabel='No additional permissions'
            showAllOption={false}
          />
        </ChipModalField>
      )}
      {!searchOnly && capabilityIds.includes(SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY.id) && (
        <ChipModalField
          type='dropdown'
          title='Member access'
          value={memberAccess}
          onChange={(value) => {
            if (value === 'search' || value === 'workflow') onMemberAccessChange(value)
          }}
          options={[
            { value: 'search', label: 'Search documents' },
            { value: 'workflow', label: 'Workflow tools' },
          ]}
          hint='Choose the same access when configuring this app for member accounts.'
        />
      )}
      {!searchOnly && (
        <SlashCommandsEditor
          commands={slashCommands}
          onChange={onSlashCommandsChange}
          error={slashCommandsError}
        />
      )}
    </>
  )
}

interface SlashCommandsEditorProps {
  commands: readonly SlackSlashCommandDraft[]
  onChange: (commands: SlackSlashCommandDraft[]) => void
  error: string | null
}

function SlashCommandsEditor({ commands, onChange, error }: SlashCommandsEditorProps) {
  const addCommand = () => {
    onChange([...commands, { id: generateId(), command: '', description: '', usageHint: '' }])
  }
  const updateCommand = (
    id: string,
    field: keyof Pick<SlackSlashCommandDraft, 'command' | 'description' | 'usageHint'>,
    value: string
  ) => {
    onChange(commands.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)))
  }
  const removeCommand = (id: string) => {
    onChange(commands.filter((entry) => entry.id !== id))
  }

  return (
    <ChipModalField type='custom' title='Slash commands (optional)' error={error}>
      <Chip className='w-fit' leftIcon={Plus} onClick={addCommand} disabled={commands.length >= 50}>
        Add
      </Chip>
      {commands.length > 0 && (
        <div className='space-y-2'>
          {commands.map((entry, index) => (
            <div
              key={entry.id}
              className='flex items-start gap-2 rounded-lg border border-[var(--border)] p-2'
            >
              <div className='min-w-0 flex-1 space-y-2'>
                <ChipInput
                  value={entry.command}
                  onChange={(event) => updateCommand(entry.id, 'command', event.target.value)}
                  placeholder='/ask-sim'
                  maxLength={32}
                  inputClassName='font-mono'
                  aria-label={`Slash command ${index + 1}`}
                />
                <ChipInput
                  value={entry.description}
                  onChange={(event) => updateCommand(entry.id, 'description', event.target.value)}
                  placeholder='Short description shown in Slack'
                  maxLength={2000}
                  aria-label={`Slash command ${index + 1} description`}
                />
                <ChipInput
                  value={entry.usageHint ?? ''}
                  onChange={(event) => updateCommand(entry.id, 'usageHint', event.target.value)}
                  placeholder='Usage hint (optional), e.g. question or task'
                  maxLength={1000}
                  aria-label={`Slash command ${index + 1} usage hint`}
                />
              </div>
              <Button
                variant='quiet'
                size='icon'
                aria-label={`Remove slash command ${index + 1}`}
                onClick={() => removeCommand(entry.id)}
              >
                <Trash className='size-[14px]' />
              </Button>
            </div>
          ))}
        </div>
      )}
    </ChipModalField>
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
              <CopyCodeButton code={manifestJson} />
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
    <ChipModalField type='custom' title={label}>
      <SecretInput value={value} onChange={onChange} placeholder={placeholder} />
    </ChipModalField>
  )
}

interface StepDoneProps {
  searchOnly: boolean
  pending: boolean
  created: boolean
  error: string | null
  onRetry: () => void
}
function StepDone({ searchOnly, pending, created, error, onRetry }: StepDoneProps) {
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
        <Chip onClick={onRetry}>Try again</Chip>
      </div>
    )
  }
  if (created) {
    return (
      <div className='flex flex-col items-center gap-4 py-10 text-center'>
        <div className='space-y-1'>
          <p className='text-[var(--text-primary)] text-base'>
            {searchOnly ? 'Slack app connected' : 'Bot connected'}
          </p>
          <p className='max-w-sm text-[var(--text-secondary)] text-sm leading-relaxed'>
            {searchOnly
              ? 'Click Done to verify member access.'
              : "It's now selectable in Slack triggers and actions across this workspace. Click Done to finish."}
          </p>
        </div>
      </div>
    )
  }
  return null
}
