import { Argument, type Command, Option } from 'commander'
import type { CommandSpec } from '../contract/types'
import {
  type CreateCredentialConnectionResponse,
  type CreateCredentialWorkloadIdentitySubjectBody,
  type CreateCredentialWorkloadIdentitySubjectResponse,
  type CreateServiceAccountCredentialResponse,
  type ListCredentialProvidersResponse,
  V2_OPERATIONS,
} from '../generated/v2-api'
import { refusalCode, SimApiError } from '../http/client'
import { describeOperation } from '../runtime/build'
import { apiCommand, type Connection } from '../runtime/called-operations'
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

const KEYLESS_SUBJECT_RESULT: CommandSpec = {
  fields: [
    { header: 'issuer' },
    { header: 'audience' },
    { header: 'subject' },
    { header: 'subject proof', path: 'subjectProof' },
    { header: 'expires', path: 'expiresAt', format: 'timestamp' },
    { header: 'auth type', path: 'keylessConfig.authType' },
    { header: 'required fields', path: 'requiredConfigFields' },
    { header: 'optional fields', path: 'optionalConfigFields' },
  ],
}

type KeylessProviderId = CreateCredentialWorkloadIdentitySubjectBody['providerId']

/** The generated enum of providers that can hold a keyless credential. */
const KEYLESS_PROVIDER_IDS =
  V2_OPERATIONS.createCredentialWorkloadIdentitySubject.body.providerId.values

/** Refusals a fresh subject fixes: the proof expired, belongs to someone else, or is already used. */
const KEYLESS_RETRY_CODES: ReadonlySet<string> = new Set([
  'WORKLOAD_IDENTITY_PROOF_EXPIRED',
  'WORKLOAD_IDENTITY_PROOF_INVALID',
  'WORKLOAD_IDENTITY_SUBJECT_REQUIRED',
  'WORKLOAD_IDENTITY_SUBJECT_IN_USE',
])

/**
 * Paragraphs separated by blank lines, then one `Examples:` block: the shape
 * the CLI docs generator renders as separate paragraphs and a code block.
 */
const KEYLESS_FLOW_HELP = [
  'Keyless (workload identity) credentials take two steps.',
  '',
  "Step 1: run `sim credentials keyless-subject <providerId> --output json` and configure your cloud to trust the printed issuer, audience, and subject. Its requiredConfigFields lists the values your provider's keylessConfig still needs.",
  '',
  "The printed audience is the default. To have Sim sign tokens for your own audience instead, set audience in keylessConfig and trust that value. Google Cloud prints no audience: its default is the credential's own workload identity pool provider.",
  '',
  'Step 2: add those values to keylessConfig and pass it to `sim credentials create <providerId> --credentials @file`.',
  '',
  `The proof expires after 24 hours and works only for the user who requested it, with the same providerId. If creation reports ${[...KEYLESS_RETRY_CODES].join(', ')}, run step 1 again, trust the new subject, and retry.`,
  '',
  'Examples:',
  '  $ sim credentials keyless-subject aws-service-account --output json > subject.json',
  `  $ jq '.keylessConfig + {"roleArn":"arn:aws:iam::123456789012:role/SimWorkflows"}' subject.json > keyless.json`,
  '  $ sim credentials create aws-service-account --name "Keyless" --credentials @keyless.json',
].join('\n')

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

async function credentialValues(
  provider: ServiceAccountProvider,
  raw: string
): Promise<Record<string, string>> {
  const parsed = await coerce(raw, { kind: 'object' }, { json: true }, 'credentials')
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SimApiError('--credentials must be a JSON object', 0)
  }

  const fields = new Map(provider.fields.map((field) => [field.id, field]))
  const values = asServiceAccountJson(parsed as Record<string, unknown>, provider)
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

  if (
    values.serviceAccountJson !== undefined &&
    (provider.keyless !== undefined || offersConfigurationAlternative(provider))
  ) {
    return values as Record<string, string>
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

/**
 * Whether the catalog lists `serviceAccountJson` as an optional alternative to
 * the provider's other fields (such as a Snowflake key pair).
 */
function offersConfigurationAlternative(provider: ServiceAccountProvider): boolean {
  return provider.fields.some((field) => field.id === 'serviceAccountJson' && !field.required)
}

/**
 * Accepts a configuration object as it is: the keylessConfig from
 * `sim credentials keyless-subject` (an object that carries a subject and its
 * proof, or the provider's keyless `authType`), or an object with an
 * `authType` where `serviceAccountJson` is an optional alternative, is sent as
 * `serviceAccountJson`.
 * Anything else is read as the provider's fields, so a misspelled field is
 * still reported as unsupported.
 */
function asServiceAccountJson(
  values: Record<string, unknown>,
  provider: ServiceAccountProvider
): Record<string, unknown> {
  const configuration =
    (values.subject !== undefined && values.subjectProof !== undefined) ||
    (provider.keyless !== undefined && values.authType === provider.keyless.authType) ||
    (values.authType !== undefined &&
      values.serviceAccountJson === undefined &&
      !provider.fields.some((field) => field.id === 'authType') &&
      offersConfigurationAlternative(provider))
  return configuration ? { serviceAccountJson: JSON.stringify(values) } : values
}

/** Names the command that fixes a refused keyless subject, keeping the API's code and details. */
function withKeylessRetryHint(error: unknown, providerId: string): unknown {
  if (!(error instanceof SimApiError)) return error
  const code = refusalCode(error)
  if (code === null || !KEYLESS_RETRY_CODES.has(code)) return error
  return new SimApiError(
    `${error.message} Run \`sim credentials keyless-subject ${providerId}\` for a new subject, trust it in your cloud, and retry.`,
    error.status,
    error.code,
    error.details,
    error.exitCode,
    error.requestId
  )
}

async function createKeylessSubject(
  { client, profile }: Connection<'createCredentialWorkloadIdentitySubject'>,
  providerId: KeylessProviderId
): Promise<void> {
  const response = await client.request<CreateCredentialWorkloadIdentitySubjectResponse>(
    'createCredentialWorkloadIdentitySubject',
    { body: { workspaceId: client.requireWorkspace(), providerId } }
  )
  renderResult(
    'createCredentialWorkloadIdentitySubject',
    profile.output,
    response.data,
    KEYLESS_SUBJECT_RESULT
  )
}

async function createServiceAccount(
  { client, profile }: Connection<'listCredentialProviders' | 'createServiceAccountCredential'>,
  providerId: string,
  options: CreateServiceAccountOptions
): Promise<void> {
  const workspaceId = client.requireWorkspace()
  const catalog = await client.request<ListCredentialProvidersResponse>('listCredentialProviders', {
    query: { workspaceId },
  })
  const provider = serviceAccountProvider(catalog.data, providerId)
  if (provider.requiresClientGeneratedCredentialId && !options.id) {
    throw new SimApiError(`--id is required for ${providerId}.`, 0)
  }

  const credentialFields = await credentialValues(provider, options.credentials)
  const response = await client
    .request<CreateServiceAccountCredentialResponse>('createServiceAccountCredential', {
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
    .catch((error: unknown) => {
      throw withKeylessRetryHint(error, providerId)
    })

  renderResult(
    'createServiceAccountCredential',
    profile.output,
    response.data,
    SERVICE_ACCOUNT_RESULT
  )
}

async function createConnectionLink(
  { client, profile }: Connection<'createCredentialConnection'>,
  body: ConnectionBody
): Promise<void> {
  const response = await client.request<CreateCredentialConnectionResponse>(
    'createCredentialConnection',
    {
      body: {
        workspaceId: client.requireWorkspace(),
        ...body,
      },
    }
  )

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

  const [create, connectCreate] = apiCommand(
    credentials,
    'create',
    ['listCredentialProviders', 'createServiceAccountCredential'],
    { runs: 'createServiceAccountCredential' }
  )
  create
    .argument('<providerId>', 'Service-account provider to create a credential for')
    .description(
      describeOperation(
        V2_OPERATIONS.createServiceAccountCredential,
        'Create a service-account credential using its discovered provider schema'
      )
    )
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
    .addHelpText(
      'after',
      [
        '',
        "--credentials takes the provider's fields, or the keylessConfig from `sim credentials keyless-subject` (with the required fields filled in). Pass @path or @- to keep secrets out of shell history.",
        '',
        KEYLESS_FLOW_HELP,
      ].join('\n')
    )
    .action((providerId: string, options: CreateServiceAccountOptions) =>
      createServiceAccount(connectCreate(), providerId, options)
    )

  const [keylessSubject, connectKeylessSubject] = apiCommand(credentials, 'keyless-subject', [
    'createCredentialWorkloadIdentitySubject',
  ])
  keylessSubject
    .addArgument(
      new Argument('<providerId>', 'Service-account provider for the keyless credential').choices([
        ...KEYLESS_PROVIDER_IDS,
      ])
    )
    .description(
      describeOperation(
        V2_OPERATIONS.createCredentialWorkloadIdentitySubject,
        'Issue the subject and proof for a new keyless (workload identity) credential'
      )
    )
    .addHelpText('after', `\n${KEYLESS_FLOW_HELP}`)
    .action((providerId: KeylessProviderId) =>
      createKeylessSubject(connectKeylessSubject(), providerId)
    )

  const [connect, connectLink] = apiCommand(credentials, 'connect', ['createCredentialConnection'])
  connect
    .argument('<providerId>', 'OAuth provider to connect')
    .description(
      describeOperation(
        V2_OPERATIONS.createCredentialConnection,
        'Create a short-lived link for connecting an OAuth provider'
      )
    )
    .requiredOption('--name <displayName>', 'Name shown for the new credential in Sim (required)')
    .action(async (providerId: string, options: { name: string }) =>
      createConnectionLink(connectLink(), { providerId, displayName: options.name })
    )

  const [reconnect, reconnectLink] = apiCommand(credentials, 'reconnect', [
    'createCredentialConnection',
  ])
  reconnect
    .argument('<credentialId>', 'Existing OAuth credential to re-authorize')
    .description(
      describeOperation(
        V2_OPERATIONS.createCredentialConnection,
        'Create a short-lived link for reconnecting an OAuth credential'
      )
    )
    .action((credentialId: string) => createConnectionLink(reconnectLink(), { credentialId }))
}
