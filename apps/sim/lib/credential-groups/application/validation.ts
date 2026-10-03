import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CREDENTIAL_GROUP_PROVIDER_IDS,
  isCredentialGroupProvider,
} from '@/lib/credential-groups/providers'
import type {
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
  if (
    option.provider === 'slack' &&
    option.slackBotCredentialId !== undefined &&
    !option.slackBotCredentialId.trim()
  ) {
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

export function validateUpdateCredentialGroupInput(
  input: UpdateCredentialGroupInput
): UpdateCredentialGroupInput {
  if (input.options === undefined && input.status === undefined) {
    throw new OrchestrationError('validation', 'At least one field must be updated')
  }
  if (input.options) validateOptions(input.options)
  return {
    ...(input.options ? { options: input.options.map(normalizeOption) } : {}),
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
