import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CREDENTIAL_GROUP_MCP_SERVER_LIMIT } from '@/lib/credential-groups/limits'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import type {
  CreateCredentialGroupInput,
  CredentialGroupOptionInput,
  CredentialGroupOptionUpdateInput,
  UpdateCredentialGroupInput,
} from '@/lib/credential-groups/types'

function validateOption(
  option: CredentialGroupOptionInput | CredentialGroupOptionUpdateInput,
  index: number
): void {
  if (!isCredentialGroupProvider(option.provider)) {
    throw new OrchestrationError('validation', `Credential option ${index + 1} is unsupported`)
  }
  if (!option.label.trim() || option.label.trim().length > 100) {
    throw new OrchestrationError(
      'validation',
      `Credential option ${index + 1} requires a label of at most 100 characters`
    )
  }
  if (option.provider === 'slack' && !option.slackBotCredentialId.trim()) {
    throw new OrchestrationError('validation', 'Select a custom Slack bot')
  }
}

function validateOptions(
  options: Array<CredentialGroupOptionInput | CredentialGroupOptionUpdateInput>
): void {
  if (options.length > CREDENTIAL_GROUP_PROVIDER_IDS.length) {
    throw new OrchestrationError('validation', 'Too many credential options')
  }
  const labels = new Set<string>()
  const providers = new Set<string>()
  const ids = new Set<string>()
  options.forEach((option, index) => {
    validateOption(option, index)
    const label = option.label.trim().toLocaleLowerCase()
    if (labels.has(label)) {
      throw new OrchestrationError('validation', 'Credential option labels must be unique')
    }
    if (providers.has(option.provider)) {
      throw new OrchestrationError('validation', 'Each provider can only be added once')
    }
    if ('id' in option && option.id) {
      if (ids.has(option.id)) {
        throw new OrchestrationError('validation', 'Credential option IDs must be unique')
      }
      ids.add(option.id)
    }
    labels.add(label)
    providers.add(option.provider)
  })
}

function normalizeOption<T extends CredentialGroupOptionInput | CredentialGroupOptionUpdateInput>(
  option: T
): T {
  return { ...option, label: option.label.trim() }
}

function validateMcpServerIds(serverIds: string[]): string[] {
  if (serverIds.length > CREDENTIAL_GROUP_MCP_SERVER_LIMIT) {
    throw new OrchestrationError(
      'validation',
      `Select at most ${CREDENTIAL_GROUP_MCP_SERVER_LIMIT} MCP servers`
    )
  }
  const normalized = serverIds.map((serverId) => serverId.trim())
  if (normalized.some((serverId) => !serverId || serverId.length > 128)) {
    throw new OrchestrationError('validation', 'Every MCP server ID must be valid')
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new OrchestrationError('validation', 'MCP server selections must be unique')
  }
  return normalized
}

export function validateCreateCredentialGroupInput(
  input: CreateCredentialGroupInput
): CreateCredentialGroupInput {
  const name = input.name.trim()
  if (!name || name.length > 100) {
    throw new OrchestrationError('validation', 'Name must be between 1 and 100 characters')
  }
  const description = input.description?.trim()
  if (description && description.length > 500) {
    throw new OrchestrationError('validation', 'Description must be at most 500 characters')
  }
  validateOptions(input.options)
  if (input.options.some((option) => option.provider === 'slack')) {
    throw new OrchestrationError(
      'validation',
      'Create the Credential Group before configuring Slack'
    )
  }
  return {
    name,
    ...(description ? { description } : {}),
    options: input.options.map(normalizeOption),
    mcpServerIds: validateMcpServerIds(input.mcpServerIds ?? []),
  }
}

export function validateUpdateCredentialGroupInput(
  input: UpdateCredentialGroupInput
): UpdateCredentialGroupInput {
  if (Object.keys(input).length === 0) {
    throw new OrchestrationError('validation', 'At least one field must be updated')
  }
  const name = input.name?.trim()
  if (input.name !== undefined && (!name || name.length > 100)) {
    throw new OrchestrationError('validation', 'Name must be between 1 and 100 characters')
  }
  const description = input.description?.trim()
  if (description && description.length > 500) {
    throw new OrchestrationError('validation', 'Description must be at most 500 characters')
  }
  if (input.options) validateOptions(input.options)
  const mcpServerIds = input.mcpServerIds ? validateMcpServerIds(input.mcpServerIds) : undefined
  return {
    ...(name ? { name } : {}),
    ...(input.description !== undefined ? { description: description || null } : {}),
    ...(input.options ? { options: input.options.map(normalizeOption) } : {}),
    ...(mcpServerIds ? { mcpServerIds } : {}),
    ...(input.status ? { status: input.status } : {}),
  }
}

export function validateCredentialGroupEnrollmentPage(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new OrchestrationError('validation', 'Limit must be an integer between 1 and 100')
  }
}

export function validateCredentialGroupInvitationEmails(emails: string[]): string[] {
  if (emails.length < 1 || emails.length > 100) {
    throw new OrchestrationError('validation', 'Invite between 1 and 100 people at once')
  }
  const normalized = [...new Set(emails.map(normalizeEmail))]
  if (normalized.some((email) => !isValidEmailSyntax(email))) {
    throw new OrchestrationError('validation', 'Every invitation email must be valid')
  }
  return normalized
}
