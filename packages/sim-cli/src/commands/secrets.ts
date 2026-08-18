import { type Command, Option } from 'commander'
import { clientFrom } from '../context'
import type { CommandSpec } from '../contract/types'
import { type SetSecretResponse, V2_OPERATIONS } from '../generated/v2-api'
import { resolvePath, SimApiError } from '../http/client'
import { renderResult } from '../runtime/result'
import { promptSecret } from '../terminal/secret-input'

const MAX_SECRET_LENGTH = 65_536
const SECRET_SCOPES = ['workspace', 'personal'] as const

const SECRET_RESULT: CommandSpec = {
  fields: [
    { header: 'name' },
    { header: 'scope' },
    { header: 'role' },
    { header: 'updated', path: 'updatedAt', format: 'timestamp' },
    { header: 'description' },
  ],
}

interface SetSecretOptions {
  scope: (typeof SECRET_SCOPES)[number]
  value?: string
  description?: string
}

function validateSecretValue(value: string): string {
  if (value.length === 0) throw new SimApiError('Secret value cannot be empty.', 0)
  if (value.length > MAX_SECRET_LENGTH) {
    throw new SimApiError(`Secret value cannot exceed ${MAX_SECRET_LENGTH} characters.`, 0)
  }
  return value
}

/**
 * A description belongs to the workspace secret teammates share; a personal
 * secret has none, and the API rejects one. Failing here names the flag rather
 * than surfacing a validation error against the request body, and does so before
 * the interactive value prompt. The length bound is left to the API, whose
 * message already names the field — a copy here would silently drift from it.
 */
function validateDescriptionScope(
  description: string | undefined,
  scope: SetSecretOptions['scope']
): string | undefined {
  if (description === undefined) return undefined
  if (scope === 'personal') {
    throw new SimApiError('--description is only supported for a workspace secret.', 0)
  }
  return description
}

async function setSecret(name: string, options: SetSecretOptions, command: Command): Promise<void> {
  const description = validateDescriptionScope(options.description, options.scope)
  const value = validateSecretValue(options.value ?? (await promptSecret()))
  const { client, profile } = clientFrom(command)
  const operation = V2_OPERATIONS.setSecret
  const response = await client.request<SetSecretResponse>(resolvePath(operation.path, { name }), {
    method: operation.method,
    body: {
      workspaceId: client.requireWorkspace(),
      scope: options.scope,
      value,
      description,
    },
  })

  renderResult('setSecret', profile.output, response.data, SECRET_RESULT)
}

/** Adds interactive secret entry while preserving an explicit value flag for scripts. */
export function attachSecretCommands(program: Command): void {
  const secrets = program.commands.find((command) => command.name() === 'secrets')
  if (!secrets) throw new Error('The generated secrets command group is missing')

  secrets
    .command('set')
    .argument('<name>', 'Secret name, as referenced in workflows')
    .description('Create or replace a named secret')
    .addOption(
      new Option('--scope <scope>', 'Secret ownership scope')
        .choices([...SECRET_SCOPES])
        .makeOptionMandatory()
    )
    .option('--value <value>', 'Secret value; visible to shell history when supplied directly')
    .option(
      '--description <description>',
      'What the secret is for, shown to teammates; workspace scope only. Omit to leave an existing description unchanged'
    )
    .action((name: string, options: SetSecretOptions, command: Command) =>
      setSecret(name, options, command)
    )
}
