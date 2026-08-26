import { type Command, Option } from 'commander'
import { clientFrom } from '../context'
import type { CommandSpec } from '../contract/types'
import {
  type CreateCredentialConnectionResponse,
  type CreateServiceAccountCredentialResponse,
  type ListCredentialProvidersResponse,
  V2_OPERATIONS,
} from '../generated/v2-api'
import { SimApiError } from '../http/client'
import { coerce } from '../runtime/request'
import { renderResult } from '../runtime/result'

const CONNECTION_RESULT: CommandSpec = {
  fields: [
    { header: 'connection link', path: 'authorizationUrl' },
    { header: 'expires', path: 'expiresAt', format: 'timestamp' },
  ],
}

const SERVICE_ACCOUNT_RESULT: CommandSpec = {
  fields: [
    { header: 'id' },
    { header: 'name', path: 'displayName' },
    { header: 'provider', path: 'providerId' },
    { header: 'role' },
    { header: 'created', path: 'createdAt', format: 'timestamp' },
  ],
}

type ConnectionBody = { providerId: string; displayName: string } | { credentialId: string }
type CredentialProvider = ListCredentialProvidersResponse['data'][number]
type ServiceAccountProvider = Extract<CredentialProvider, { type: 'service_account' }>

interface CreateServiceAccountOptions {
  credentials: string
  description?: string
  id?: string
  name: string
}

function serviceAccountProvider(
  providers: CredentialProvider[],
  providerId: string
): ServiceAccountProvider {
  const provider = providers.find(
    (candidate): candidate is ServiceAccountProvider =>
      candidate.type === 'service_account' && candidate.providerId === providerId
  )
  if (!provider) {
    throw new SimApiError(`Unknown service-account provider "${providerId}".`, 0)
  }
  if (!provider.available) {
    throw new SimApiError(`Service-account provider "${providerId}" is not available.`, 0)
  }
  return provider
}

function credentialValues(provider: ServiceAccountProvider, raw: string): Record<string, string> {
  const parsed = coerce(raw, { kind: 'object' }, { json: true }, 'credentials')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SimApiError('--credentials must be a JSON object', 0)
  }

  const values = parsed as Record<string, unknown>
  const fields = new Map(provider.fields.map((field) => [field.id, field]))
  for (const [id, value] of Object.entries(values)) {
    const field = fields.get(id)
    if (!field) {
      throw new SimApiError(
        `--credentials contains unsupported field "${id}" for ${provider.providerId}.`,
        0
      )
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new SimApiError(`--credentials.${id} must be a non-empty string.`, 0)
    }
    if (field.options && !field.options.some((option) => option.value === value)) {
      throw new SimApiError(
        `--credentials.${id} must be one of: ${field.options.map((option) => option.value).join(', ')}.`,
        0
      )
    }
  }

  const authMethod = typeof values.authMethod === 'string' ? values.authMethod : undefined
  const missing = provider.fields
    .filter(
      (field) =>
        field.required ||
        (authMethod !== undefined && field.requiredForAuthMethods?.includes(authMethod))
    )
    .filter((field) => values[field.id] === undefined)
    .map((field) => field.id)
  if (missing.length > 0) {
    throw new SimApiError(
      `--credentials is missing required fields for ${provider.providerId}: ${missing.join(', ')}.`,
      0
    )
  }

  return values as Record<string, string>
}

async function createServiceAccount(
  command: Command,
  providerId: string,
  options: CreateServiceAccountOptions
): Promise<void> {
  const { client, profile } = clientFrom(command)
  const workspaceId = client.requireWorkspace()
  const discovery = V2_OPERATIONS.listCredentialProviders
  const catalog = await client.request<ListCredentialProvidersResponse>(discovery.path, {
    method: discovery.method,
    query: { workspaceId },
  })
  const provider = serviceAccountProvider(catalog.data, providerId)
  if (provider.requiresClientGeneratedCredentialId && !options.id) {
    throw new SimApiError(`--id is required for ${providerId}.`, 0)
  }

  const credentialFields = credentialValues(provider, options.credentials)
  const operation = V2_OPERATIONS.createServiceAccountCredential
  const response = await client.request<CreateServiceAccountCredentialResponse>(operation.path, {
    method: operation.method,
    body: {
      workspaceId,
      type: 'service_account',
      providerId,
      displayName: options.name,
      ...(options.description ? { description: options.description } : {}),
      ...(options.id ? { id: options.id } : {}),
      credentials: JSON.stringify(credentialFields),
    },
  })

  renderResult(
    'createServiceAccountCredential',
    profile.output,
    response.data,
    SERVICE_ACCOUNT_RESULT
  )
}

async function createConnectionLink(command: Command, body: ConnectionBody): Promise<void> {
  const { client, profile } = clientFrom(command)
  const operation = V2_OPERATIONS.createCredentialConnection
  const response = await client.request<CreateCredentialConnectionResponse>(operation.path, {
    method: operation.method,
    body: {
      workspaceId: client.requireWorkspace(),
      ...body,
    },
  })

  renderResult('createCredentialConnection', profile.output, response.data, CONNECTION_RESULT)
}

/**
 * Teaches the generated `credentials update` command the `--name` spelling.
 *
 * `credentials create` names a credential with `--name` while its sibling
 * spells the same field `--display-name`, so the obvious `update --name` was
 * rejected outright. Both are accepted here rather than one being renamed:
 * `--display-name` is published, and removing a flag breaks existing scripts.
 * Supplying both is refused, because they are one field and no reading of which
 * value wins is more likely to be the intended one.
 */
function acceptNameOnUpdate(credentials: Command): void {
  const update = credentials.commands.find((command) => command.name() === 'update')
  if (!update) throw new Error('The generated credentials update command is missing')

  update
    .addOption(new Option('--name <displayName>', 'Alias for --display-name'))
    .hook('preAction', (_parent, action) => {
      const options = action.opts()
      if (options.name === undefined) return
      if (options.displayName !== undefined) {
        throw new SimApiError('--name and --display-name are the same field; pass one, not both', 0)
      }
      options.displayName = options.name
    })
}

/** Adds the human-facing OAuth connection commands backed by the v2 credentials API. */
export function attachCredentialCommands(program: Command): void {
  const credentials = program.commands.find((command) => command.name() === 'credentials')
  if (!credentials) throw new Error('The generated credentials command group is missing')

  acceptNameOnUpdate(credentials)

  credentials
    .command('create')
    .argument('<providerId>', 'Service-account provider to create a credential for')
    .description('Create a service-account credential using its discovered provider schema')
    // The `(required)` suffix is the marker the generated flags carry, and it
    // is literal text rather than something commander renders — a hand-written
    // mandatory option that omits it is the only kind of required flag whose
    // help does not say so.
    .requiredOption('--name <displayName>', 'Name shown for the credential in Sim (required)')
    .requiredOption(
      '--credentials <json|@file>',
      'Provider credentials as JSON (or @path / @- to read a file or stdin) (required)'
    )
    .option('--description <description>', 'Optional credential description')
    .option(
      '--id <credentialId>',
      'Client-generated credential ID when provider discovery requires it'
    )
    .action((providerId: string, options: CreateServiceAccountOptions, command: Command) =>
      createServiceAccount(command, providerId, options)
    )

  credentials
    .command('connect')
    .argument('<providerId>', 'OAuth provider to connect')
    .description('Create a short-lived link for connecting an OAuth provider')
    .requiredOption('--name <displayName>', 'Name shown for the new credential in Sim (required)')
    .action(async (providerId: string, options: { name: string }, command: Command) =>
      createConnectionLink(command, { providerId, displayName: options.name })
    )

  credentials
    .command('reconnect')
    .argument('<credentialId>', 'Existing OAuth credential to re-authorize')
    .description('Create a short-lived link for reconnecting an OAuth credential')
    .action((credentialId: string, _options: unknown, command: Command) =>
      createConnectionLink(command, { credentialId })
    )
}
