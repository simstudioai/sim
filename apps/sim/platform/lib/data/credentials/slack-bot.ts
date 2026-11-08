import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { resourceScopeFields, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  buildSlackAppCreationUrl,
  buildSlackCustomBotRequestUrl,
  getSlackAppNameError,
  SLACK_APP_CREATION_URL_MAX_LENGTH,
} from '@/lib/integrations/slack-manifest'
import { SLACK_CUSTOM_BOT_PROVIDER_ID } from '@/lib/oauth/types'
import { useCreateScopedCredential } from '@/hooks/queries/scoped-credentials'
import {
  buildSlackManifest,
  getSlackManagedUserAuthorizationManifestConfig,
  SLACK_CAPABILITIES,
  SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY,
  type SlackSlashCommand,
} from '@/triggers/slack/capabilities'

const logger = createLogger('SlackBotForm')

const DEFAULT_APP_NAME = 'Sim Bot'
const MAX_SLASH_COMMANDS = 50

const CUSTOM_BOT_CAPABILITIES = [
  ...SLACK_CAPABILITIES,
  SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY,
] as const

const DEFAULT_CAPABILITY_IDS = CUSTOM_BOT_CAPABILITIES.filter(
  (capability) => capability.defaultChecked
).map((capability) => capability.id)

const CAPABILITY_OPTIONS = CUSTOM_BOT_CAPABILITIES.map((capability) => ({
  value: capability.id,
  label: capability.label,
}))

/** One slash command row of the bot's manifest, keyed so the editor can reorder and remove it. */
export interface SlackSlashCommandDraft extends SlackSlashCommand {
  id: string
}

type SlashCommandField = keyof Pick<SlackSlashCommandDraft, 'command' | 'description' | 'usageHint'>

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

interface UseSlackBotFormOptions {
  open: boolean
  workspaceId: string
  onCreated: (credentialId: string) => void
}

/**
 * The custom Slack bot setup behind the credential picker, with the legacy dialog's validation,
 * generated manifest and payload. The credential id is minted up front because the manifest embeds
 * the ingest URL `/api/webhooks/slack/custom/{id}`; it survives closing and reopening until a bot is
 * actually saved, so a Slack app already pointed at that URL can still be finished under it.
 * `submit` resolves once the credential exists and `onCreated` has it, or rejects with a readable
 * message and keeps the draft.
 */
export function useSlackBotForm({ open, workspaceId, onCreated }: UseSlackBotFormOptions) {
  const [credentialId, setCredentialId] = useState(generateId)
  const [appName, setAppName] = useState('')
  const [appDescription, setAppDescription] = useState('')
  const [capabilityIds, setCapabilityIds] = useState<string[]>(DEFAULT_CAPABILITY_IDS)
  const [slashCommands, setSlashCommands] = useState<SlackSlashCommandDraft[]>([])
  const [signingSecret, setSigningSecret] = useState('')
  const [botToken, setBotToken] = useState('')
  const [wasOpen, setWasOpen] = useState(open)
  const createCredential = useCreateScopedCredential()

  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) {
      setAppName('')
      setAppDescription('')
      setCapabilityIds(DEFAULT_CAPABILITY_IDS)
      setSlashCommands([])
      setSigningSecret('')
      setBotToken('')
    }
  }

  const requestUrl = buildSlackCustomBotRequestUrl(credentialId)
  const nameError = getSlackAppNameError(appName)
  const descriptionError = getAgentDescriptionError(appDescription)
  const slashCommandsError = getSlashCommandsError(slashCommands)
  const manifestConfigurationError = descriptionError ?? slashCommandsError

  const manifestJson = useMemo(() => {
    if (manifestConfigurationError) return ''
    const capabilities = new Set(capabilityIds)
    const managedUserAuthorization = capabilities.has(
      SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY.id
    )
      ? getSlackManagedUserAuthorizationManifestConfig(getBaseUrl())
      : undefined
    const manifest = buildSlackManifest(capabilities, {
      appName: appName.trim() || DEFAULT_APP_NAME,
      webhookUrl: requestUrl,
      description: appDescription,
      slashCommands: slashCommands.map(({ command, description, usageHint }) => ({
        command,
        description,
        usageHint,
      })),
      ...(managedUserAuthorization ? { managedUserAuthorization } : {}),
    })
    return JSON.stringify(manifest)
  }, [
    manifestConfigurationError,
    capabilityIds,
    appName,
    appDescription,
    slashCommands,
    requestUrl,
  ])

  const createAppUrl = buildSlackAppCreationUrl(manifestJson)
  const creationUrlError =
    createAppUrl.length > SLACK_APP_CREATION_URL_MAX_LENGTH
      ? 'This app configuration is too large to open in Slack. Shorten or remove slash commands.'
      : null

  const addSlashCommand = () =>
    setSlashCommands((current) => [
      ...current,
      { id: generateId(), command: '', description: '', usageHint: '' },
    ])
  const updateSlashCommand = (id: string, field: SlashCommandField, value: string) =>
    setSlashCommands((current) =>
      current.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry))
    )
  const removeSlashCommand = (id: string) =>
    setSlashCommands((current) => current.filter((entry) => entry.id !== id))

  const configurationInvalid =
    appName.trim().length === 0 ||
    Boolean(nameError) ||
    Boolean(manifestConfigurationError) ||
    Boolean(creationUrlError)
  const isPending = createCredential.isPending

  const submit = async () => {
    try {
      await createCredential.mutateAsync({
        ...resourceScopeFields(resourceScopeFromOwner({ workspaceId })),
        type: 'service_account',
        providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
        id: credentialId,
        signingSecret: signingSecret.trim(),
        botToken: botToken.trim(),
        displayName: appName.trim() || undefined,
        description: appDescription.trim() || undefined,
      })
      setCredentialId(generateId())
      onCreated(credentialId)
    } catch (error) {
      logger.error('Failed to add custom Slack bot credential', error)
      throw new Error(getErrorMessage(error, 'Could not connect the Slack bot.'))
    }
  }

  return {
    defaultAppName: DEFAULT_APP_NAME,
    appName,
    setAppName,
    nameError: (appName && nameError) || undefined,
    appDescription,
    setAppDescription,
    descriptionError: descriptionError ?? undefined,
    capabilityOptions: CAPABILITY_OPTIONS,
    capabilityIds,
    setCapabilityIds,
    allCapabilitiesSelected: capabilityIds.length === CUSTOM_BOT_CAPABILITIES.length,
    slashCommands,
    addSlashCommand,
    updateSlashCommand,
    removeSlashCommand,
    canAddSlashCommand: slashCommands.length < MAX_SLASH_COMMANDS,
    slashCommandsError: slashCommandsError ?? creationUrlError ?? undefined,
    configurationInvalid,
    createAppUrl: manifestJson ? createAppUrl : null,
    botToken,
    setBotToken,
    signingSecret,
    setSigningSecret,
    isPending,
    submit,
  }
}
