import { ImapFlow } from 'imapflow'
import { validateDatabaseHost } from '@/lib/core/security/input-validation.server'
import { resolveEffectiveEnvironmentVariables } from '@/lib/environment/utils'

const EXACT_ENVIRONMENT_REFERENCE = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/

export class ImapConnectionPolicyError extends Error {
  constructor(readonly code: 'context' | 'hidden_auth' | 'destination' | 'transport') {
    super('IMAP connection is unavailable')
    this.name = 'ImapConnectionPolicyError'
  }
}

export interface ImapConnectionInput {
  host: unknown
  port?: unknown
  secure?: unknown
  username: unknown
  password: unknown
}

export interface ResolvedImapConnection {
  host: string
  port: number
  secure: boolean
  username: string
  password: string
}

function containsTemplateDelimiter(value: string): boolean {
  return value.includes('{{') || value.includes('}}')
}

export function hasImapEnvironmentReferences(input: ImapConnectionInput): boolean {
  return [input.host, input.port, input.secure, input.username, input.password].some(
    (value) => typeof value === 'string' && EXACT_ENVIRONMENT_REFERENCE.test(value)
  )
}

function normalizeConnection(input: ImapConnectionInput): ResolvedImapConnection {
  const host = typeof input.host === 'string' ? input.host.trim() : ''
  const username = typeof input.username === 'string' ? input.username : ''
  const password = typeof input.password === 'string' ? input.password : ''
  const port = input.port === undefined || input.port === '' ? 993 : Number(input.port)
  const secure =
    input.secure === undefined || input.secure === ''
      ? true
      : typeof input.secure === 'string'
        ? input.secure.toLowerCase() === 'true'
        : input.secure === true

  if (!host || !username || !password || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ImapConnectionPolicyError('context')
  }
  return { host, port, secure, username, password }
}

/** Resolves only exact references and rejects hidden shared authentication material. */
export async function resolveImapConnectionForActor(input: {
  connection: ImapConnectionInput
  actorUserId: string
  workspaceId?: string | null
}): Promise<ResolvedImapConnection> {
  if (!hasImapEnvironmentReferences(input.connection)) {
    return normalizeLiteralImapConnection(input.connection)
  }

  const referenceNames = [
    ...new Set(
      [
        input.connection.host,
        input.connection.port,
        input.connection.secure,
        input.connection.username,
        input.connection.password,
      ].flatMap((value) => {
        if (typeof value !== 'string') return []
        const match = EXACT_ENVIRONMENT_REFERENCE.exec(value)
        if (match) return [match[1]]
        if (containsTemplateDelimiter(value)) throw new ImapConnectionPolicyError('context')
        return []
      })
    ),
  ]
  const resolvedVariables = await resolveEffectiveEnvironmentVariables(
    input.actorUserId,
    input.workspaceId ?? undefined,
    referenceNames
  )

  const resolve = (field: 'host' | 'port' | 'secure' | 'username' | 'password', value: unknown) => {
    if (typeof value !== 'string') return value
    const match = EXACT_ENVIRONMENT_REFERENCE.exec(value)
    if (!match) return value
    const name = match[1]
    const variable = Object.hasOwn(resolvedVariables, name) ? resolvedVariables[name] : undefined
    if (!variable) throw new ImapConnectionPolicyError('context')
    if ((field === 'username' || field === 'password') && !variable.visible) {
      throw new ImapConnectionPolicyError('hidden_auth')
    }
    return variable.value
  }

  return normalizeResolvedImapConnection({
    host: resolve('host', input.connection.host),
    port: resolve('port', input.connection.port),
    secure: resolve('secure', input.connection.secure),
    username: resolve('username', input.connection.username),
    password: resolve('password', input.connection.password),
  })
}

/** Normalizes values only after exact environment references have been resolved and authorized. */
export function normalizeResolvedImapConnection(
  input: ImapConnectionInput
): ResolvedImapConnection {
  return normalizeConnection(input)
}

export function normalizeLiteralImapConnection(input: ImapConnectionInput): ResolvedImapConnection {
  for (const value of [input.host, input.port, input.secure, input.username, input.password]) {
    if (typeof value === 'string' && containsTemplateDelimiter(value)) {
      throw new ImapConnectionPolicyError('context')
    }
  }
  return normalizeConnection(input)
}

/** Validates and pins the user-controlled destination before any IMAP authentication occurs. */
export async function createSecureImapClient(
  connection: ResolvedImapConnection,
  signal?: AbortSignal
): Promise<ImapFlow> {
  signal?.throwIfAborted()
  const validation = await validateDatabaseHost(connection.host, 'host', { logDetails: false })
  signal?.throwIfAborted()
  if (!validation.isValid || !validation.resolvedIP) {
    throw new ImapConnectionPolicyError('destination')
  }
  return new ImapFlow({
    host: validation.resolvedIP,
    servername: connection.host,
    port: connection.port,
    secure: connection.secure,
    ...(connection.secure ? {} : { doSTARTTLS: true }),
    auth: { user: connection.username, pass: connection.password },
    tls: { rejectUnauthorized: true },
    logger: false,
  })
}

export async function listImapMailboxes(
  connection: ResolvedImapConnection,
  signal?: AbortSignal
): Promise<Array<{ path: string; name: string; delimiter: string | false | null }>> {
  const client = await createSecureImapClient(connection, signal)
  const abort = () => client.close()
  signal?.addEventListener('abort', abort, { once: true })
  try {
    signal?.throwIfAborted()
    await client.connect()
    signal?.throwIfAborted()
    const mailboxes = (await client.list()).map((mailbox) => ({
      path: mailbox.path,
      name: mailbox.name,
      delimiter: mailbox.delimiter,
    }))
    mailboxes.sort((left, right) => {
      if (left.path === 'INBOX') return -1
      if (right.path === 'INBOX') return 1
      return left.path.localeCompare(right.path)
    })
    return mailboxes
  } finally {
    signal?.removeEventListener('abort', abort)
    try {
      await client.logout()
    } catch {
      client.close()
    }
  }
}
