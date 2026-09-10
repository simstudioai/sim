import { createHash, createPrivateKey, createSign } from 'node:crypto'
import { z } from 'zod'
import { env } from '@/lib/core/config/env'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import type {
  GitHubInstallationBinding,
  GitHubInstallationRepositoryScope,
  GitHubInstallationSummary,
} from '@/lib/oauth/github-installation-types'
import { parseGitHubRepository } from '@/lib/oauth/github-repository'

const API_URL = 'https://api.github.com'
const PAGE_SIZE = 100
const MAX_PAGES = 10
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 10_000
const OPERATION_TIMEOUT_MS = 30_000
const TOKEN_HEADROOM_MS = 5 * 60_000
const MAX_CACHED_TOKENS = 128

const idSchema = z
  .string()
  .regex(/^[1-9]\d{0,15}$/)
  .refine((id) => Number.isSafeInteger(Number(id)))
const apiIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
const loginSchema = z.string().regex(/^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i)
const permissionsSchema = z.object({
  contents: z.enum(['read', 'write']).optional(),
  metadata: z.literal('read').optional(),
})
const installationSchema = z.object({
  id: apiIdSchema,
  app_id: apiIdSchema,
  client_id: z.string().min(1).max(200).optional(),
  account: z.object({
    id: apiIdSchema,
    login: loginSchema,
    type: z.enum(['User', 'Organization']),
  }),
  repository_selection: z.enum(['all', 'selected']),
  permissions: permissionsSchema,
  suspended_at: z.string().nullable(),
})
const bindingSchema = z
  .object({
    type: z.literal('github_app_installation'),
    version: z.literal(1),
    appId: idSchema,
    appClientId: z.string().min(1).max(200),
    installationId: idSchema,
    accountId: idSchema,
    accountType: z.enum(['User', 'Organization']),
    accountLogin: loginSchema,
    repositorySelection: z.enum(['all', 'selected']),
  })
  .strict()
const repositorySchema = z.object({
  id: apiIdSchema,
  full_name: z.string().min(1).max(200),
  owner: z.object({ id: apiIdSchema }),
  default_branch: z.string().min(1).max(1024),
})

export class GitHubInstallationError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'GitHubInstallationError'
  }
}

function readConfiguration() {
  const appId = env.GITHUB_APP_ID?.trim()
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim()
  const clientSecretConfigured = Boolean(env.GITHUB_APP_CLIENT_SECRET?.trim())
  const privateKey = env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, '\n').trim()
  const slug = env.GITHUB_APP_SLUG?.trim()
  if (
    !appId ||
    !idSchema.safeParse(appId).success ||
    !clientId ||
    !clientSecretConfigured ||
    !privateKey ||
    !slug ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
  )
    return null
  try {
    const key = createPrivateKey(privateKey)
    if (key.asymmetricKeyType !== 'rsa') return null
    return {
      appId,
      clientId,
      key,
      slug,
      keyRevision: createHash('sha256').update(privateKey).digest('hex'),
    }
  } catch {
    return null
  }
}

/** Exposes readiness and the provider installation URL without returning signing material. */
export function getGitHubInstallationConfiguration() {
  const configuration = readConfiguration()
  return {
    configured: configuration !== null,
    installUrl: configuration
      ? `https://github.com/apps/${configuration.slug}/installations/new`
      : null,
  }
}

function requireConfiguration() {
  const configuration = readConfiguration()
  if (!configuration)
    throw new GitHubInstallationError('GitHub App installation setup is not configured')
  return configuration
}

function createAppJwt(configuration: NonNullable<ReturnType<typeof readConfiguration>>) {
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: configuration.clientId })
  ).toString('base64url')
  const message = `${header}.${payload}`
  return `${message}.${createSign('RSA-SHA256').update(message).sign(configuration.key).toString('base64url')}`
}

interface RequestOptions {
  signal?: AbortSignal
}

function operationSignal(options: RequestOptions): AbortSignal {
  const timeout = AbortSignal.timeout(OPERATION_TIMEOUT_MS)
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
}

async function request(
  path: string,
  token: string,
  signal: AbortSignal,
  body?: unknown
): Promise<unknown> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
  const response = await fetch(`${API_URL}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Sim',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'error',
    signal: requestSignal,
  })
  if (!response.ok) {
    await response.body?.cancel()
    throw new GitHubInstallationError(
      `GitHub installation request failed with HTTP ${response.status}`,
      response.status
    )
  }
  return readResponseJsonWithLimit(response, {
    maxBytes: MAX_RESPONSE_BYTES,
    signal: requestSignal,
    label: 'GitHub installation response',
  })
}

function summary(
  installation: z.output<typeof installationSchema>,
  clientId: string
): GitHubInstallationSummary {
  return {
    appId: String(installation.app_id),
    appClientId: clientId,
    installationId: String(installation.id),
    accountId: String(installation.account.id),
    accountType: installation.account.type,
    accountLogin: installation.account.login,
    repositorySelection: installation.repository_selection,
  }
}

function installationIsReady(
  installation: z.output<typeof installationSchema>,
  configuration: { appId: string; clientId: string }
) {
  return (
    String(installation.app_id) === configuration.appId &&
    (installation.client_id === undefined || installation.client_id === configuration.clientId) &&
    installation.suspended_at === null &&
    Boolean(installation.permissions.contents) &&
    installation.permissions.metadata === 'read'
  )
}

/** Rejects malformed encrypted blobs without interpreting an installation as a human identity. */
export function parseGitHubInstallationBinding(value: unknown): GitHubInstallationBinding {
  const parsed = bindingSchema.safeParse(value)
  if (!parsed.success)
    throw new GitHubInstallationError('Stored GitHub installation binding is invalid')
  return parsed.data
}

async function adminAccountIds(userAccessToken: string, signal: AbortSignal) {
  if (!userAccessToken.startsWith('ghu_'))
    throw new GitHubInstallationError('Connect your GitHub account before choosing an installation')
  const user = z
    .object({ id: apiIdSchema, type: z.literal('User') })
    .parse(await request('/user', userAccessToken, signal))
  const organizations = new Set<string>()
  const membershipsSchema = z
    .array(
      z.object({
        state: z.enum(['active', 'pending']),
        role: z.enum(['admin', 'member', 'billing_manager']),
        organization: z.object({ id: apiIdSchema }),
        user: z.object({ id: apiIdSchema }),
      })
    )
    .max(PAGE_SIZE)
  for (let page = 1; page <= MAX_PAGES; page++) {
    const memberships = membershipsSchema.parse(
      await request(
        `/user/memberships/orgs?state=active&per_page=${PAGE_SIZE}&page=${page}`,
        userAccessToken,
        signal
      )
    )
    for (const membership of memberships) {
      if (membership.user.id !== user.id)
        throw new GitHubInstallationError(
          'GitHub membership identity does not match the connected account'
        )
      if (membership.state === 'active' && membership.role === 'admin')
        organizations.add(String(membership.organization.id))
    }
    if (memberships.length < PAGE_SIZE) return { userId: String(user.id), organizations }
  }
  throw new GitHubInstallationError(
    'GitHub organization membership listing exceeds the supported limit'
  )
}

/** User-visible installations are filtered by actual account ownership, not mere repository access. */
export async function listUserAdminGitHubInstallations(
  userAccessToken: string,
  options: RequestOptions = {}
): Promise<GitHubInstallationSummary[]> {
  const configuration = requireConfiguration()
  const signal = operationSignal(options)
  const accounts = await adminAccountIds(userAccessToken, signal)
  const result: GitHubInstallationSummary[] = []
  const pageSchema = z.object({
    total_count: z
      .number()
      .int()
      .min(0)
      .max(PAGE_SIZE * MAX_PAGES),
    installations: z.array(installationSchema).max(PAGE_SIZE),
  })
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = pageSchema.parse(
      await request(
        `/user/installations?per_page=${PAGE_SIZE}&page=${page}`,
        userAccessToken,
        signal
      )
    )
    for (const installation of data.installations) {
      const ownsAccount =
        installation.account.type === 'User'
          ? String(installation.account.id) === accounts.userId
          : accounts.organizations.has(String(installation.account.id))
      if (ownsAccount && installationIsReady(installation, configuration))
        result.push(summary(installation, configuration.clientId))
    }
    if (data.installations.length < PAGE_SIZE) return result
  }
  throw new GitHubInstallationError('GitHub installation listing exceeds the supported limit')
}

async function readBoundInstallation(
  binding: GitHubInstallationBinding,
  path: string,
  options: RequestOptions = {}
) {
  const verified = parseGitHubInstallationBinding(binding)
  const configuration = requireConfiguration()
  if (verified.appId !== configuration.appId || verified.appClientId !== configuration.clientId)
    throw new GitHubInstallationError('GitHub installation belongs to a different configured app')
  const installation = installationSchema.parse(
    await request(path, createAppJwt(configuration), operationSignal(options))
  )
  if (
    !installationIsReady(installation, configuration) ||
    String(installation.id) !== verified.installationId ||
    String(installation.account.id) !== verified.accountId ||
    installation.account.type !== verified.accountType
  )
    throw new GitHubInstallationError(
      'GitHub installation is unavailable or its account binding changed'
    )
  return summary(installation, configuration.clientId)
}

/** Rechecks current provider state so cached content tokens never hide app suspension or rebinding. */
export async function assertGitHubInstallationActive(
  binding: GitHubInstallationBinding,
  options: RequestOptions = {}
) {
  return readBoundInstallation(binding, `/app/installations/${binding.installationId}`, options)
}

/** Rechecks the repository's current installation even when its public content remains readable. */
export async function assertGitHubInstallationRepositoryActive(
  binding: GitHubInstallationBinding,
  repository: string,
  options: RequestOptions = {}
): Promise<void> {
  const { owner, repo } = parseGitHubRepository(repository)
  await readBoundInstallation(
    binding,
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/installation`,
    options
  )
}

/** Requires both the initiating GitHub user's account authority and the server's current app identity. */
export async function verifyGitHubInstallationBinding(
  userAccessToken: string,
  installationId: string,
  options: RequestOptions = {}
): Promise<GitHubInstallationBinding> {
  if (!idSchema.safeParse(installationId).success)
    throw new GitHubInstallationError('GitHub installation ID is invalid')
  const signal = operationSignal(options)
  const installations = await listUserAdminGitHubInstallations(userAccessToken, { signal })
  const installation = installations.find(
    (candidate) => candidate.installationId === installationId
  )
  if (!installation)
    throw new GitHubInstallationError(
      'Only the GitHub account owner or an organization owner can connect this installation'
    )
  const binding: GitHubInstallationBinding = {
    type: 'github_app_installation',
    version: 1,
    ...installation,
  }
  return {
    type: 'github_app_installation',
    version: 1,
    ...(await assertGitHubInstallationActive(binding, { signal })),
  }
}

interface CachedToken {
  accessToken: string
  expiresAt: number
}
const tokenCache = new Map<string, CachedToken>()

async function mintToken(
  binding: GitHubInstallationBinding,
  signal: AbortSignal,
  repositoryId?: string,
  repositoryName?: string
) {
  const configuration = requireConfiguration()
  const key = [
    configuration.keyRevision,
    binding.appClientId,
    binding.installationId,
    binding.accountId,
    repositoryId ?? `metadata:${repositoryName}`,
  ].join(':')
  for (const [cachedKey, entry] of tokenCache)
    if (entry.expiresAt <= Date.now() + TOKEN_HEADROOM_MS) tokenCache.delete(cachedKey)
  const cached = tokenCache.get(key)
  if (cached) return cached.accessToken
  const permissions = repositoryId ? { contents: 'read', metadata: 'read' } : { metadata: 'read' }
  const response = z
    .object({
      token: z.string().min(1).max(1024),
      expires_at: z.iso.datetime(),
      permissions: permissionsSchema.strict(),
      repositories: z
        .array(z.object({ id: apiIdSchema }))
        .max(1)
        .optional(),
    })
    .parse(
      await request(
        `/app/installations/${binding.installationId}/access_tokens`,
        createAppJwt(configuration),
        signal,
        {
          permissions,
          ...(repositoryId
            ? { repository_ids: [Number(repositoryId)] }
            : { repositories: [repositoryName] }),
        }
      )
    )
  const expiresAt = Date.parse(response.expires_at)
  if (
    expiresAt <= Date.now() + TOKEN_HEADROOM_MS ||
    expiresAt > Date.now() + 65 * 60_000 ||
    response.permissions.metadata !== 'read' ||
    response.permissions.contents !== (repositoryId ? 'read' : undefined) ||
    !response.repositories ||
    response.repositories.length !== 1 ||
    (repositoryId && String(response.repositories[0].id) !== repositoryId)
  ) {
    throw new GitHubInstallationError(
      'GitHub returned an invalid installation token scope or expiration'
    )
  }
  if (tokenCache.size >= MAX_CACHED_TOKENS) {
    const oldest = tokenCache.keys().next().value
    if (oldest !== undefined) tokenCache.delete(oldest)
  }
  tokenCache.set(key, { accessToken: response.token, expiresAt })
  return response.token
}

/** Resolves a mutable repository name to its immutable identity inside the bound GitHub account. */
export async function resolveGitHubInstallationRepository(
  binding: GitHubInstallationBinding,
  repository: string,
  options: RequestOptions = {}
) {
  let parsed: ReturnType<typeof parseGitHubRepository>
  try {
    parsed = parseGitHubRepository(repository)
  } catch {
    throw new GitHubInstallationError('Use a GitHub repository in owner/repo format')
  }
  const { owner, repo } = parsed
  const signal = operationSignal(options)
  await assertGitHubInstallationActive(binding, { signal })
  const token = await mintToken(binding, signal, undefined, repo)
  const resolved = repositorySchema.parse(
    await request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token, signal)
  )
  if (String(resolved.owner.id) !== binding.accountId)
    throw new GitHubInstallationError('Repository belongs to another GitHub installation account')
  return {
    id: String(resolved.id),
    fullName: resolved.full_name,
    defaultBranch: resolved.default_branch,
  }
}

/** Mints contents access for exactly one source repository; generic unscoped token reads are refused. */
export async function resolveGitHubInstallationAccessToken(
  binding: GitHubInstallationBinding,
  scope: GitHubInstallationRepositoryScope,
  options: RequestOptions = {}
) {
  const signal = operationSignal(options)
  let repositoryId = scope.repositoryId
  if (repositoryId && !idSchema.safeParse(repositoryId).success)
    throw new GitHubInstallationError('GitHub repository ID is invalid')
  if (!repositoryId && scope.repository)
    repositoryId = (
      await resolveGitHubInstallationRepository(binding, scope.repository, { signal })
    ).id
  if (!repositoryId)
    throw new GitHubInstallationError('GitHub installation tokens require a source repository')
  await assertGitHubInstallationActive(binding, { signal })
  return { accessToken: await mintToken(binding, signal, repositoryId) }
}
