import type {
  BitbucketBranch,
  BitbucketComment,
  BitbucketCommit,
  BitbucketCommitStatus,
  BitbucketDiffstat,
  BitbucketDirectoryEntry,
  BitbucketFileMetadata,
  BitbucketListOutput,
  BitbucketPage,
  BitbucketParticipant,
  BitbucketPipeline,
  BitbucketPipelineStep,
  BitbucketPullRequest,
  BitbucketPullRequestEndpoint,
  BitbucketRepository,
  BitbucketUser,
  BitbucketWorkspaceAccess,
} from '@/tools/bitbucket/types'
import type { ToolRetryConfig } from '@/tools/types'

export const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0'
export const BITBUCKET_ERROR_EXTRACTOR = 'bitbucket-errors'
export const BITBUCKET_DEFAULT_MAX_CHARACTERS = 100_000
export const BITBUCKET_MAX_CHARACTERS = 500_000
export const BITBUCKET_DEFAULT_LOG_CHARACTERS = 20_000
export const BITBUCKET_MAX_LOG_CHARACTERS = 200_000
export const BITBUCKET_MIN_LOG_RANGE_BYTES = 4_096
export const BITBUCKET_RAW_TRANSFER_MAX_BYTES = 10 * 1024 * 1024
/**
 * Step logs are read as a suffix `Range`, but a storage backend may answer `200` with the whole
 * log, which `readRollingTailBytes` then walks to keep only the tail. The secure transport enqueues
 * without backpressure, so this budget caps peak resident bytes for such a read, not just transfer.
 */
export const BITBUCKET_LOG_TRANSFER_MAX_BYTES = 16 * 1024 * 1024

export const BITBUCKET_READ_RETRY: ToolRetryConfig = {
  enabled: true,
  maxRetries: 2,
  retryIdempotentOnly: true,
}

export const BITBUCKET_ACCESS_TOKEN_PARAM = {
  type: 'string',
  required: true,
  visibility: 'hidden' as const,
  description: 'Bitbucket OAuth access token',
}

export const BITBUCKET_REPOSITORY_PARAMS = {
  workspaceSlug: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm' as const,
    description: 'Bitbucket workspace slug or UUID',
  },
  repoSlug: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm' as const,
    description: 'Bitbucket repository slug or UUID',
  },
  accessToken: {
    type: 'string',
    required: true,
    visibility: 'hidden' as const,
    description: 'Bitbucket OAuth access token',
  },
}

export const BITBUCKET_PULL_REQUEST_PARAMS = {
  ...BITBUCKET_REPOSITORY_PARAMS,
  prId: {
    type: 'number',
    required: true,
    visibility: 'user-or-llm' as const,
    description: 'Repository-scoped pull request ID',
  },
}

export const BITBUCKET_PAGINATION_PARAMS = {
  nextUrl: {
    type: 'string',
    required: false,
    visibility: 'user-or-llm' as const,
    description: 'Opaque next-page URL returned by a previous Bitbucket call',
  },
  pageLen: {
    type: 'number',
    required: false,
    visibility: 'user-or-llm' as const,
    description: 'Results per page (1-100)',
    default: 20,
  },
}

type JsonRecord = Record<string, unknown>

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null
}

function readRecord(record: JsonRecord | null, key: string): JsonRecord | null {
  return asRecord(record?.[key])
}

function readString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function readNumber(record: JsonRecord | null, key: string): number | null {
  const value = record?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(record: JsonRecord | null, key: string): boolean | null {
  const value = record?.[key]
  return typeof value === 'boolean' ? value : null
}

function readRequiredString(record: JsonRecord, key: string, context: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Bitbucket ${context}.${key} must be a non-empty string`)
  }
  return value
}

function requireResourceRecord(value: unknown, context: string): JsonRecord {
  const record = asRecord(value)
  if (!record) throw new Error(`Bitbucket ${context} must be an object`)
  readRequiredString(record, 'type', context)
  return record
}

function readOptionalArray(record: JsonRecord, key: string, context: string): unknown[] | null {
  const value = record[key]
  if (value === undefined) return null
  if (!Array.isArray(value)) {
    throw new Error(`Bitbucket ${context}.${key} must be an array when present`)
  }
  return value
}

function readOptionalStringArray(
  record: JsonRecord,
  key: string,
  context: string
): string[] | null {
  const values = readOptionalArray(record, key, context)
  return (
    values?.map((value, index) => {
      if (typeof value !== 'string') {
        throw new Error(`Bitbucket ${context}.${key}[${index}] must be a string`)
      }
      return value
    }) ?? null
  )
}

function readOptionalStringOrArray(
  record: JsonRecord,
  key: string,
  context: string
): string[] | null {
  const value = record[key]
  if (value === undefined) return null
  if (typeof value === 'string') return [value]
  return readOptionalStringArray(record, key, context)
}

function readNullableNumber(record: JsonRecord, key: string, context: string): number | null {
  const value = record[key]
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Bitbucket ${context}.${key} must be a finite number or null`)
  }
  return value
}

function linkHref(record: JsonRecord | null, name: string): string | null {
  return readString(readRecord(readRecord(record, 'links'), name), 'href')
}

export function requireBitbucketString(value: string, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} must be a non-empty string`)
  }
  return value.trim()
}

export function encodeBitbucketSegment(value: string, name: string): string {
  const normalized = requireBitbucketString(value, name)
  if (normalized === '.' || normalized === '..') {
    throw new Error(`${name} cannot be a dot path segment`)
  }
  return encodeURIComponent(normalized)
}

export function encodeBitbucketRepositoryPath(path: string, allowEmpty = false): string {
  if (typeof path !== 'string') throw new Error('path must be a string')
  const normalized = path.replace(/^\/+|\/+$/g, '')
  if (!normalized) {
    if (allowEmpty) return ''
    throw new Error('path must be a non-empty repository-relative path')
  }
  return normalized
    .split('/')
    .map((segment) => {
      if (segment.length === 0) throw new Error('path cannot contain an empty segment')
      if (segment === '.' || segment === '..') {
        throw new Error('path cannot contain a dot segment')
      }
      return encodeURIComponent(segment)
    })
    .join('/')
}

export function bitbucketRepositoryPathQuery(path: string): string {
  if (typeof path !== 'string') throw new Error('path must be a string')
  const normalized = path.replace(/^\/+|\/+$/g, '')
  if (normalized.length === 0) {
    throw new Error('path must be a non-empty repository-relative path')
  }
  encodeBitbucketRepositoryPath(normalized)
  return normalized
}

export function positiveBitbucketInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function bitbucketPageLength(value: number | undefined): number {
  const pageLen = value ?? 20
  if (!Number.isSafeInteger(pageLen) || pageLen < 1 || pageLen > 100) {
    throw new Error('pageLen must be an integer between 1 and 100')
  }
  return pageLen
}

export function bitbucketMaxCharacters(value: number | undefined, log = false): number {
  const defaultValue = log ? BITBUCKET_DEFAULT_LOG_CHARACTERS : BITBUCKET_DEFAULT_MAX_CHARACTERS
  const limit = log ? BITBUCKET_MAX_LOG_CHARACTERS : BITBUCKET_MAX_CHARACTERS
  const resolved = value ?? defaultValue
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > limit) {
    throw new Error(`maxCharacters must be an integer between 1 and ${limit}`)
  }
  return resolved
}

export function bitbucketHeadRange(maxCharacters: number | undefined): string {
  const byteLimit = bitbucketMaxCharacters(maxCharacters) * 4
  return `bytes=0-${byteLimit - 1}`
}

export function bitbucketTailRange(maxCharacters: number | undefined): string {
  const byteLimit = Math.max(
    bitbucketMaxCharacters(maxCharacters, true) * 4,
    BITBUCKET_MIN_LOG_RANGE_BYTES
  )
  return `bytes=-${byteLimit}`
}

export function bitbucketHeaders(
  accessToken: string,
  options: { json?: boolean; range?: string } = {}
): Record<string, string> {
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    throw new Error('Missing Bitbucket OAuth access token')
  }
  return {
    Accept: options.json === false ? '*/*' : 'application/json',
    Authorization: `Bearer ${accessToken}`,
    ...(options.json ? { 'Content-Type': 'application/json' } : {}),
    ...(options.range ? { Range: options.range } : {}),
  }
}

export function bitbucketRepositoryPath(workspaceSlug: string, repoSlug: string): string {
  return `/repositories/${encodeBitbucketSegment(workspaceSlug, 'workspaceSlug')}/${encodeBitbucketSegment(repoSlug, 'repoSlug')}`
}

export function bitbucketPullRequestPath(
  workspaceSlug: string,
  repoSlug: string,
  prId: number
): string {
  return `${bitbucketRepositoryPath(workspaceSlug, repoSlug)}/pullrequests/${positiveBitbucketInteger(prId, 'prId')}`
}

export function validateBitbucketOpaqueUrl(value: string): string {
  const candidate = requireBitbucketString(value, 'nextUrl')
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    throw new Error('nextUrl must be a valid absolute URL')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'api.bitbucket.org' ||
    parsed.port !== '' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== '' ||
    !parsed.pathname.startsWith('/2.0/')
  ) {
    throw new Error('nextUrl must be an HTTPS Bitbucket Cloud API 2.0 URL')
  }
  return parsed.toString()
}

/**
 * Bitbucket resolves workspace and repository slugs case-insensitively but echoes the canonical
 * lowercase form in `next` links, redirect `Location` headers, and merge task URLs. Binding those
 * back to the caller's slug must therefore ignore case, or a mixed-case slug that Bitbucket just
 * accepted fails on the follow-up request.
 *
 * Only those two segments are canonicalized, so only those two are folded. Fixed API literals and
 * repository file paths compare verbatim, keeping a malformed path a deterministic local failure
 * rather than one deferred to Bitbucket. Hex revisions are folded by their own dedicated check.
 */
function isBitbucketSlugSegment(segments: string[], index: number): boolean {
  return segments[0] === '2.0' && segments[1] === 'repositories' && (index === 2 || index === 3)
}

function bitbucketSegmentsMatch(candidate: string[], expected: string[]): boolean {
  if (candidate.length !== expected.length) return false
  return expected.every(
    (segment, index) =>
      candidate[index] === segment ||
      (isBitbucketSlugSegment(expected, index) && equalsIgnoreCase(candidate[index], segment))
  )
}

/** Compares two absolute API paths segment-wise under the slug-only case rule above. */
function bitbucketPathsMatch(candidatePath: string, expectedPath: string): boolean {
  return bitbucketSegmentsMatch(
    candidatePath.replace(/^\//, '').split('/'),
    expectedPath.replace(/^\//, '').split('/')
  )
}

/** True when `candidatePath` begins with every segment of `expectedPrefix`, same case rule. */
function bitbucketPathHasPrefix(candidatePath: string, expectedPrefix: string): boolean {
  const expected = expectedPrefix.replace(/^\//, '').replace(/\/$/, '').split('/')
  const candidate = candidatePath.replace(/^\//, '').split('/')
  return (
    candidate.length > expected.length &&
    bitbucketSegmentsMatch(candidate.slice(0, expected.length), expected)
  )
}

export function equalsIgnoreCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

export function bitbucketRepositoryPathHasPrefix(
  candidatePath: string,
  expectedPrefix: string
): boolean {
  return bitbucketPathHasPrefix(candidatePath, expectedPrefix)
}

export type BitbucketPullRequestRedirectKind = 'diff' | 'diffstat'

export function validateBitbucketPullRequestRedirect(
  value: string,
  workspaceSlug: string,
  repoSlug: string,
  kind: BitbucketPullRequestRedirectKind
): string {
  const validated = validateBitbucketOpaqueUrl(value)
  const parsed = new URL(validated)
  const expectedPrefix = `/2.0${bitbucketRepositoryPath(workspaceSlug, repoSlug)}/${kind}/`
  const encodedSpec = bitbucketPathHasPrefix(parsed.pathname, expectedPrefix)
    ? parsed.pathname.slice(expectedPrefix.length)
    : ''
  if (!encodedSpec) {
    throw new Error(`Bitbucket ${kind} redirect did not target this repository's ${kind} endpoint`)
  }

  /**
   * Bitbucket documents the redirect target as the repository `{kind}/{spec}`
   * endpoint. In live responses that opaque spec is repository-qualified, for
   * example `source-workspace/source-repo:sourceHash%0DdestinationHash`, so it
   * legitimately spans multiple URL path segments. The exact API origin and
   * destination repository remain bound above; only the trailing spec is
   * treated as provider-owned opaque path data.
   */
  for (const segment of encodedSpec.split('/')) {
    if (!segment) {
      throw new Error(`Bitbucket ${kind} redirect contained an empty spec path segment`)
    }
    try {
      decodeURIComponent(segment)
    } catch {
      throw new Error(`Bitbucket ${kind} redirect contained invalid path encoding`)
    }
  }
  return parsed.toString()
}

export async function assertBitbucketResponseOk(response: Response): Promise<void> {
  if (response.ok) return
  const errorBytes = await readBoundedBytes(response, 4_000).catch(() => ({
    bytes: new Uint8Array(),
    clipped: false,
  }))
  const errorBody = new TextDecoder().decode(errorBytes.bytes)
  let message = errorBody
  try {
    const parsed: unknown = JSON.parse(errorBody)
    const error = readRecord(asRecord(parsed), 'error')
    const summary = readString(error, 'message')
    const detail = readString(error, 'detail')
    message =
      summary && detail && detail !== summary
        ? `${summary}: ${detail}`
        : (summary ?? detail ?? errorBody)
  } catch {
    message = errorBody
  }
  throw new Error(message || `Bitbucket API error: ${response.status} ${response.statusText}`)
}

export function bitbucketApiUrl(
  path: string,
  options: {
    nextUrl?: string
    pageLen?: number
    query?: Record<string, string | number | boolean | undefined>
    nextPathPrefix?: string
    nextPathSuffix?: string
    nextRevision?: string
  } = {}
): string {
  if (options.nextUrl !== undefined) {
    const validated = validateBitbucketOpaqueUrl(options.nextUrl)
    const decodePath = (pathname: string): string[] => {
      const withoutLeadingSlash = pathname.startsWith('/') ? pathname.slice(1) : pathname
      const normalized = withoutLeadingSlash.endsWith('/')
        ? withoutLeadingSlash.slice(0, -1)
        : withoutLeadingSlash
      if (normalized.length === 0) return []
      const encodedSegments = normalized.split('/')
      if (encodedSegments.some((segment) => segment.length === 0)) {
        throw new Error('nextUrl cannot contain empty path segments')
      }
      try {
        return encodedSegments.map((segment) => decodeURIComponent(segment))
      } catch {
        throw new Error('nextUrl contains invalid path encoding')
      }
    }
    const candidatePath = new URL(validated).pathname
    const exactPath = `/2.0${path}`.replace(/\/$/, '')
    const prefix = options.nextPathPrefix
      ? `/2.0${options.nextPathPrefix}`.replace(/\/$/, '')
      : null
    if (prefix) {
      const candidateSegments = decodePath(candidatePath)
      const prefixSegments = decodePath(prefix)
      if (
        candidateSegments.length <= prefixSegments.length ||
        !bitbucketSegmentsMatch(candidateSegments.slice(0, prefixSegments.length), prefixSegments)
      ) {
        throw new Error('nextUrl does not belong to this Bitbucket list endpoint')
      }
      const revisionAndPath = candidateSegments.slice(prefixSegments.length)
      if (
        options.nextRevision === undefined ||
        !equalsIgnoreCase(revisionAndPath[0], options.nextRevision)
      ) {
        throw new Error('nextUrl does not preserve the requested Bitbucket revision')
      }
      const expectedSuffix = decodePath(options.nextPathSuffix ?? '')
      const actualSuffix = revisionAndPath.slice(1)
      if (
        actualSuffix.length !== expectedSuffix.length ||
        !expectedSuffix.every((segment, index) => actualSuffix[index] === segment)
      ) {
        throw new Error('nextUrl does not preserve the requested Bitbucket directory path')
      }
    } else if (!bitbucketPathsMatch(candidatePath.replace(/\/$/, ''), exactPath)) {
      throw new Error('nextUrl does not belong to this Bitbucket list endpoint')
    }
    return validated
  }
  const url = new URL(`${BITBUCKET_API_BASE}${path}`)
  for (const [key, value] of Object.entries(options.query ?? {}) as Array<[string, unknown]>) {
    if (value === undefined) continue
    if (
      (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') ||
      (typeof value === 'number' && !Number.isFinite(value))
    ) {
      throw new Error(`Bitbucket query parameter ${key} must be a string, number, or boolean`)
    }
    url.searchParams.set(key, String(value))
  }
  if (Object.hasOwn(options, 'pageLen')) {
    url.searchParams.set('pagelen', String(bitbucketPageLength(options.pageLen)))
  }
  return url.toString()
}

export async function bitbucketJson(response: Response): Promise<JsonRecord> {
  const data: unknown = await response.json()
  const record = asRecord(data)
  if (!record) throw new Error('Bitbucket returned a non-object JSON response')
  return record
}

function normalizePage(data: JsonRecord): BitbucketPage {
  const pageLink = (key: 'next' | 'previous'): string | null => {
    const value = data[key]
    if (value === undefined || value === null) return null
    if (typeof value !== 'string') throw new Error(`Bitbucket pagination ${key} must be a URL`)
    return validateBitbucketOpaqueUrl(value)
  }
  return {
    size: readNumber(data, 'size'),
    page: readNumber(data, 'page'),
    pageLen: readNumber(data, 'pagelen'),
    nextUrl: pageLink('next'),
    previousUrl: pageLink('previous'),
  }
}

export function normalizeBitbucketPage<T>(
  data: JsonRecord,
  normalize: (value: unknown) => T
): BitbucketListOutput<T> {
  if (!Array.isArray(data.values)) {
    throw new Error('Bitbucket pagination response must include a values array')
  }
  return {
    items: data.values.map(normalize),
    page: normalizePage(data),
  }
}

export function normalizeBitbucketUser(value: unknown): BitbucketUser | null {
  if (value === undefined || value === null) return null
  const data = requireResourceRecord(value, 'account')
  return {
    type: readRequiredString(data, 'type', 'account'),
    uuid: readString(data, 'uuid'),
    accountId: readString(data, 'account_id'),
    displayName: readString(data, 'display_name'),
    createdOn: readString(data, 'created_on'),
    selfUrl: linkHref(data, 'self'),
    htmlUrl: linkHref(data, 'html'),
    avatarUrl: linkHref(data, 'avatar'),
  }
}

export function normalizeBitbucketWorkspaceAccess(value: unknown): BitbucketWorkspaceAccess {
  const data = requireResourceRecord(value, 'workspace access')
  const workspace = readRecord(data, 'workspace')
  return {
    type: readRequiredString(data, 'type', 'workspace access'),
    slug: readString(workspace, 'slug'),
    uuid: readString(workspace, 'uuid'),
    administrator: readBoolean(data, 'administrator'),
    selfUrl: linkHref(workspace, 'self'),
    avatarUrl: linkHref(workspace, 'avatar'),
  }
}

export function normalizeBitbucketRepository(value: unknown): BitbucketRepository {
  const data = requireResourceRecord(value, 'repository')
  const project = readRecord(data, 'project')
  return {
    type: readRequiredString(data, 'type', 'repository'),
    uuid: readString(data, 'uuid'),
    slug: readString(data, 'slug'),
    name: readString(data, 'name'),
    fullName: readString(data, 'full_name'),
    description: readString(data, 'description'),
    isPrivate: readBoolean(data, 'is_private'),
    scm: readString(data, 'scm'),
    language: readString(data, 'language'),
    size: readNumber(data, 'size'),
    createdOn: readString(data, 'created_on'),
    updatedOn: readString(data, 'updated_on'),
    mainBranch: readString(readRecord(data, 'mainbranch'), 'name'),
    owner: normalizeBitbucketUser(data?.owner),
    project: project
      ? {
          uuid: readString(project, 'uuid'),
          key: readString(project, 'key'),
          name: readString(project, 'name'),
        }
      : null,
    selfUrl: linkHref(data, 'self'),
    htmlUrl: linkHref(data, 'html'),
  }
}

export function normalizeBitbucketCommit(value: unknown): BitbucketCommit {
  const data = requireResourceRecord(value, 'commit')
  const author = readRecord(data, 'author')
  const committer = readRecord(data, 'committer')
  const parents = readOptionalArray(data, 'parents', 'commit')
  return {
    type: readRequiredString(data, 'type', 'commit'),
    hash: readString(data, 'hash'),
    date: readString(data, 'date'),
    message: readString(data, 'message'),
    summary: readString(readRecord(data, 'summary'), 'raw'),
    authorRaw: readString(author, 'raw'),
    author: normalizeBitbucketUser(author?.user),
    committerRaw: readString(committer, 'raw'),
    committer: normalizeBitbucketUser(committer?.user),
    parents:
      parents?.map((parent, index) => {
        const parentData = requireResourceRecord(parent, `commit.parents[${index}]`)
        return { hash: readString(parentData, 'hash') }
      }) ?? null,
    selfUrl: linkHref(data, 'self'),
    htmlUrl: linkHref(data, 'html'),
  }
}

export function normalizeBitbucketBranch(value: unknown): BitbucketBranch {
  const data = requireResourceRecord(value, 'branch')
  const target = readRecord(data, 'target')
  const mergeStrategies = readOptionalArray(data, 'merge_strategies', 'branch')
  return {
    type: readRequiredString(data, 'type', 'branch'),
    name: readString(data, 'name'),
    target: target ? normalizeBitbucketCommit(target) : null,
    mergeStrategies:
      mergeStrategies?.map((strategy, index) => {
        if (typeof strategy !== 'string') {
          throw new Error(`Bitbucket branch.merge_strategies[${index}] must be a string`)
        }
        return strategy
      }) ?? null,
    defaultMergeStrategy: readString(data, 'default_merge_strategy'),
    selfUrl: linkHref(data, 'self'),
    htmlUrl: linkHref(data, 'html'),
  }
}

export function normalizeBitbucketDirectoryEntry(value: unknown): BitbucketDirectoryEntry {
  const data = requireResourceRecord(value, 'directory entry')
  const attributes = readOptionalStringOrArray(data, 'attributes', 'directory entry')
  return {
    type: readRequiredString(data, 'type', 'directory entry'),
    path: readString(data, 'path'),
    commitHash: readString(readRecord(data, 'commit'), 'hash'),
    size: readNumber(data, 'size'),
    attributes,
    isBinary: attributes?.includes('binary') ?? null,
    selfUrl: linkHref(data, 'self'),
    metadataUrl: linkHref(data, 'meta'),
  }
}

export function normalizeBitbucketFileMetadata(value: unknown): BitbucketFileMetadata {
  const data = requireResourceRecord(value, 'file metadata')
  const type = readRequiredString(data, 'type', 'file metadata')
  if (type === 'commit_directory') {
    throw new Error('Bitbucket source path is a directory; use list_directory instead')
  }
  if (type !== 'commit_file') {
    throw new Error('Bitbucket file metadata.type must be commit_file')
  }
  const attributes = readOptionalStringOrArray(data, 'attributes', 'file metadata')
  return {
    type,
    path: readString(data, 'path'),
    commitHash: readString(readRecord(data, 'commit'), 'hash'),
    escapedPath: readString(data, 'escaped_path'),
    size: readNullableNumber(data, 'size', 'file metadata'),
    attributes,
    isBinary: attributes?.includes('binary') ?? null,
  }
}

function normalizePullRequestEndpoint(value: unknown): BitbucketPullRequestEndpoint | null {
  const data = asRecord(value)
  if (!data) return null
  return {
    branchName: readString(readRecord(data, 'branch'), 'name'),
    commitHash: readString(readRecord(data, 'commit'), 'hash'),
    repositoryUuid: readString(readRecord(data, 'repository'), 'uuid'),
    repositoryFullName: readString(readRecord(data, 'repository'), 'full_name'),
  }
}

export function normalizeBitbucketParticipant(value: unknown): BitbucketParticipant {
  const data = requireResourceRecord(value, 'participant')
  return {
    type: readRequiredString(data, 'type', 'participant'),
    user: normalizeBitbucketUser(data?.user),
    role: readString(data, 'role'),
    approved: readBoolean(data, 'approved'),
    state: readString(data, 'state'),
    participatedOn: readString(data, 'participated_on'),
  }
}

export function normalizeBitbucketPullRequest(value: unknown): BitbucketPullRequest {
  const data = requireResourceRecord(value, 'pull request')
  const renderedDescription = readRecord(readRecord(data, 'rendered'), 'description')
  const reviewers = readOptionalArray(data, 'reviewers', 'pull request')
  const participants = readOptionalArray(data, 'participants', 'pull request')
  return {
    type: readRequiredString(data, 'type', 'pull request'),
    id: readNumber(data, 'id'),
    title: readString(data, 'title'),
    description:
      readString(data, 'description') ??
      readString(renderedDescription, 'raw') ??
      readString(readRecord(data, 'summary'), 'raw'),
    state: readString(data, 'state'),
    draft: readBoolean(data, 'draft'),
    queued: readBoolean(data, 'queued'),
    author: normalizeBitbucketUser(data?.author),
    closedBy: normalizeBitbucketUser(data?.closed_by),
    source: normalizePullRequestEndpoint(data?.source),
    destination: normalizePullRequestEndpoint(data?.destination),
    mergeCommitHash: readString(readRecord(data, 'merge_commit'), 'hash'),
    commentCount: readNumber(data, 'comment_count'),
    taskCount: readNumber(data, 'task_count'),
    closeSourceBranch: readBoolean(data, 'close_source_branch'),
    reason: readString(data, 'reason'),
    createdOn: readString(data, 'created_on'),
    updatedOn: readString(data, 'updated_on'),
    reviewers:
      reviewers?.map((reviewer, index) => {
        const normalized = normalizeBitbucketUser(reviewer)
        if (!normalized) {
          throw new Error(`Bitbucket pull request.reviewers[${index}] must be an account object`)
        }
        return normalized
      }) ?? null,
    participants: participants?.map(normalizeBitbucketParticipant) ?? null,
    selfUrl: linkHref(data, 'self'),
    htmlUrl: linkHref(data, 'html'),
  }
}

export function normalizeBitbucketComment(value: unknown): BitbucketComment {
  const data = requireResourceRecord(value, 'comment')
  const inline = readRecord(data, 'inline')
  const resolution = readRecord(data, 'resolution')
  return {
    type: readRequiredString(data, 'type', 'comment'),
    id: readNumber(data, 'id'),
    createdOn: readString(data, 'created_on'),
    updatedOn: readString(data, 'updated_on'),
    content: readString(readRecord(data, 'content'), 'raw'),
    user: normalizeBitbucketUser(data?.user),
    deleted: readBoolean(data, 'deleted'),
    parentId: readNumber(readRecord(data, 'parent'), 'id'),
    inline: inline
      ? {
          path: readString(inline, 'path'),
          from: readNumber(inline, 'from'),
          to: readNumber(inline, 'to'),
          startFrom: readNumber(inline, 'start_from'),
          startTo: readNumber(inline, 'start_to'),
        }
      : null,
    pending: readBoolean(data, 'pending'),
    resolution: resolution
      ? {
          resolver: normalizeBitbucketUser(resolution.user),
          resolvedOn: readString(resolution, 'created_on'),
        }
      : null,
    selfUrl: linkHref(data, 'self'),
    htmlUrl: linkHref(data, 'html'),
  }
}

export function normalizeBitbucketCommitStatus(value: unknown): BitbucketCommitStatus {
  const data = requireResourceRecord(value, 'commit status')
  return {
    type: readRequiredString(data, 'type', 'commit status'),
    key: readString(data, 'key'),
    refName: readString(data, 'refname'),
    url: readString(data, 'url'),
    state: readString(data, 'state'),
    name: readString(data, 'name'),
    description: readString(data, 'description'),
    createdOn: readString(data, 'created_on'),
    updatedOn: readString(data, 'updated_on'),
    selfUrl: linkHref(data, 'self'),
    commitUrl: linkHref(data, 'commit'),
  }
}

export function normalizeBitbucketDiffstat(value: unknown): BitbucketDiffstat {
  const data = requireResourceRecord(value, 'diffstat')
  const oldFile = readRecord(data, 'old')
  const newFile = readRecord(data, 'new')
  return {
    type: readRequiredString(data, 'type', 'diffstat'),
    status: readString(data, 'status'),
    linesAdded: readNumber(data, 'lines_added'),
    linesRemoved: readNumber(data, 'lines_removed'),
    oldPath: readString(oldFile, 'path'),
    newPath: readString(newFile, 'path'),
    oldCommitHash: readString(readRecord(oldFile, 'commit'), 'hash'),
    newCommitHash: readString(readRecord(newFile, 'commit'), 'hash'),
  }
}

export function normalizeBitbucketPipeline(value: unknown): BitbucketPipeline {
  const data = requireResourceRecord(value, 'pipeline')
  const target = readRecord(data, 'target')
  const selector = readRecord(target, 'selector')
  const state = readRecord(data, 'state')
  const stateError = readRecord(readRecord(state, 'result'), 'error')
  return {
    type: readRequiredString(data, 'type', 'pipeline'),
    uuid: readString(data, 'uuid'),
    buildNumber: readNumber(data, 'build_number'),
    creator: normalizeBitbucketUser(data?.creator),
    repositoryFullName: readString(readRecord(data, 'repository'), 'full_name'),
    target: target
      ? {
          type: readString(target, 'type'),
          refType: readString(target, 'ref_type'),
          refName: readString(target, 'ref_name'),
          commitHash: readString(readRecord(target, 'commit'), 'hash'),
          selectorType: readString(selector, 'type'),
          selectorPattern: readString(selector, 'pattern'),
        }
      : null,
    triggerType: readString(readRecord(data, 'trigger'), 'type'),
    state: state
      ? {
          name: readString(state, 'name'),
          stage: readString(readRecord(state, 'stage'), 'name'),
          result: readString(readRecord(state, 'result'), 'name'),
          errorKey: readString(stateError, 'key'),
          errorMessage: readString(stateError, 'message'),
        }
      : null,
    createdOn: readString(data, 'created_on'),
    completedOn: readString(data, 'completed_on'),
    buildSecondsUsed: readNumber(data, 'build_seconds_used'),
    selfUrl: linkHref(data, 'self'),
    stepsUrl: linkHref(data, 'steps'),
  }
}

function normalizePipelineCommands(
  data: JsonRecord,
  key: 'setup_commands' | 'script_commands'
): Array<{
  name: string | null
  command: string | null
}> | null {
  const commands = readOptionalArray(data, key, 'pipeline step')
  return (
    commands?.map((command, index) => {
      const commandData = asRecord(command)
      if (!commandData) {
        throw new Error(`Bitbucket pipeline step.${key}[${index}] must be an object`)
      }
      return {
        name: readString(commandData, 'name'),
        command: readString(commandData, 'command'),
      }
    }) ?? null
  )
}

export function normalizeBitbucketPipelineStep(value: unknown): BitbucketPipelineStep {
  const data = requireResourceRecord(value, 'pipeline step')
  const state = readRecord(data, 'state')
  const stateError = readRecord(readRecord(state, 'result'), 'error')
  return {
    type: readRequiredString(data, 'type', 'pipeline step'),
    uuid: readString(data, 'uuid'),
    startedOn: readString(data, 'started_on'),
    completedOn: readString(data, 'completed_on'),
    state: state
      ? {
          name: readString(state, 'name'),
          result: readString(readRecord(state, 'result'), 'name'),
          errorKey: readString(stateError, 'key'),
          errorMessage: readString(stateError, 'message'),
        }
      : null,
    imageName: readString(readRecord(data, 'image'), 'name'),
    setupCommands: normalizePipelineCommands(data, 'setup_commands'),
    scriptCommands: normalizePipelineCommands(data, 'script_commands'),
  }
}

interface ParsedContentRange {
  start: number
  end: number
  total: number | null
}

function parseContentRange(header: string | null): ParsedContentRange | null {
  const match = header?.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/)
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  const total = match[3] === '*' ? null : Number(match[3])
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    (total !== null && (!Number.isSafeInteger(total) || total < 1 || end >= total))
  ) {
    return null
  }
  return { start, end, total }
}

function requireContentRange(response: Response): ParsedContentRange {
  const range = parseContentRange(response.headers.get('content-range'))
  if (!range) {
    throw new Error('Bitbucket 206 response must include a valid Content-Range header')
  }
  const expectedBytes = range.end - range.start + 1
  const contentLength = parseByteCount(response.headers.get('content-length'))
  if (contentLength !== null && contentLength !== expectedBytes) {
    throw new Error('Bitbucket 206 Content-Length does not match Content-Range')
  }
  return range
}

function assertContentRangeBody(
  range: ParsedContentRange,
  byteLength: number,
  clipped: boolean
): void {
  if (clipped || byteLength !== range.end - range.start + 1) {
    throw new Error('Bitbucket 206 response body does not match Content-Range')
  }
}

function parseByteCount(value: string | null): number | null {
  if (!value || !/^\d+$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

async function readBoundedBytes(
  response: Response,
  maxBytes: number
): Promise<{ bytes: Uint8Array; clipped: boolean }> {
  if (!response.body) return { bytes: new Uint8Array(), clipped: false }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let kept = 0
  let clipped = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const remaining = maxBytes - kept
      if (remaining <= 0) {
        clipped = true
        await reader.cancel()
        break
      }
      if (value.byteLength > remaining) {
        chunks.push(value.slice(0, remaining))
        kept += remaining
        clipped = true
        await reader.cancel()
        break
      }
      chunks.push(value)
      kept += value.byteLength
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(kept)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, clipped }
}

async function readRollingTailBytes(
  response: Response,
  maxBytes: number
): Promise<{ bytes: Uint8Array; totalBytes: number }> {
  if (!response.body) return { bytes: new Uint8Array(), totalBytes: 0 }
  const reader = response.body.getReader()
  let tail = new Uint8Array()
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (value.byteLength >= maxBytes) {
        tail = value.slice(value.byteLength - maxBytes)
        continue
      }
      const keepFromTail = Math.min(tail.byteLength, maxBytes - value.byteLength)
      const combined = new Uint8Array(keepFromTail + value.byteLength)
      combined.set(tail.slice(tail.byteLength - keepFromTail), 0)
      combined.set(value, keepFromTail)
      tail = combined
    }
  } finally {
    reader.releaseLock()
  }
  return { bytes: tail, totalBytes }
}

function decodeUtf8Tail(bytes: Uint8Array, mayStartMidCharacter: boolean): string {
  const maxOffset = mayStartMidCharacter ? Math.min(3, bytes.byteLength) : 0
  for (let offset = 0; offset <= maxOffset; offset++) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(offset))
    } catch {}
  }
  throw new Error('Bitbucket pipeline log is not valid UTF-8 text')
}

function decodeUtf8Prefix(
  bytes: Uint8Array,
  allowTrailingIncomplete: boolean,
  allowLossy: boolean
): { text: string; lossy: boolean } {
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true }).decode(bytes, {
        stream: allowTrailingIncomplete,
      }),
      lossy: false,
    }
  } catch {
    if (!allowLossy) {
      throw new Error('Bitbucket file text is not valid UTF-8; inspect file metadata instead')
    }
    return {
      text: new TextDecoder('utf-8').decode(bytes, { stream: allowTrailingIncomplete }),
      lossy: true,
    }
  }
}

function sliceUnicodePrefix(text: string, maxCodeUnits: number): string {
  if (text.length <= maxCodeUnits) return text
  let end = maxCodeUnits
  const last = text.charCodeAt(end - 1)
  const next = text.charCodeAt(end)
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end -= 1
  return text.slice(0, end)
}

function sliceUnicodeSuffix(text: string, maxCodeUnits: number): string {
  if (text.length <= maxCodeUnits) return text
  let start = text.length - maxCodeUnits
  const first = text.charCodeAt(start)
  const previous = text.charCodeAt(start - 1)
  if (first >= 0xdc00 && first <= 0xdfff && previous >= 0xd800 && previous <= 0xdbff) start += 1
  return text.slice(start)
}

export async function bitbucketRawHead(
  response: Response,
  maxCharacters: number | undefined,
  binary: boolean | null,
  options: { allowLossyUtf8?: boolean } = {}
): Promise<{
  content: string | null
  binary: boolean | null
  truncated: boolean | null
  returnedBytes: number
  fullBytes: number | null
  contentType: string | null
  decodingLossy?: boolean
}> {
  const limit = bitbucketMaxCharacters(maxCharacters)
  const range = response.status === 206 ? requireContentRange(response) : null
  if (range && range.start !== 0) {
    throw new Error('Bitbucket 206 prefix response must start at byte 0')
  }
  const { bytes, clipped } = await readBoundedBytes(response, limit * 4)
  if (range) assertContentRangeBody(range, bytes.byteLength, clipped)
  const partial = range !== null && (range.total === null || range.end + 1 < range.total)
  let text: string | null = null
  let decodingLossy = false
  const effectiveBinary = binary === null && bytes.includes(0) ? true : binary
  if (effectiveBinary !== true) {
    const decoded = decodeUtf8Prefix(bytes, clipped || partial, options.allowLossyUtf8 === true)
    text = decoded.text
    decodingLossy = decoded.lossy
  }
  const contentLength = parseByteCount(response.headers.get('content-length'))
  const fullBytes =
    response.status === 206
      ? (range?.total ?? null)
      : (contentLength ?? (clipped ? null : bytes.byteLength))
  return {
    content: text === null ? null : sliceUnicodePrefix(text, limit),
    binary: effectiveBinary,
    truncated:
      effectiveBinary === true
        ? fullBytes === null
          ? null
          : fullBytes > 0
        : clipped || partial || (text !== null && text.length > limit),
    returnedBytes: bytes.byteLength,
    fullBytes,
    contentType: response.headers.get('content-type'),
    ...(options.allowLossyUtf8 ? { decodingLossy } : {}),
  }
}

export async function bitbucketRawTail(
  response: Response,
  maxCharacters: number | undefined
): Promise<{ log: string; truncated: boolean; totalBytes: number | null }> {
  const limit = bitbucketMaxCharacters(maxCharacters, true)
  const range = response.status === 206 ? requireContentRange(response) : null
  if (range !== null && range.total !== null && range.end !== range.total - 1) {
    throw new Error('Bitbucket 206 log response must describe a suffix of the complete log')
  }
  const retainedByteLimit = limit * 4
  const byteLimit =
    response.status === 206
      ? Math.max(retainedByteLimit, BITBUCKET_MIN_LOG_RANGE_BYTES)
      : retainedByteLimit
  const read =
    response.status === 206
      ? await readBoundedBytes(response, byteLimit)
      : await readRollingTailBytes(response, byteLimit)
  const clipped = 'clipped' in read ? read.clipped : read.totalBytes > byteLimit
  if (range) assertContentRangeBody(range, read.bytes.byteLength, clipped)
  const partialStart = (range !== null && range.start > 0) || clipped
  const text = decodeUtf8Tail(read.bytes, partialStart)
  const bounded = sliceUnicodeSuffix(text, limit)
  const droppedPrefixLength = text.length - bounded.length
  const startsMidLine =
    droppedPrefixLength > 0 ? text.charCodeAt(droppedPrefixLength - 1) !== 0x0a : partialStart
  const firstBreak = startsMidLine ? bounded.indexOf('\n') : -1
  const trimmed = firstBreak === -1 ? bounded : bounded.slice(firstBreak + 1)
  return {
    log: trimmed.length === 0 ? bounded : trimmed,
    truncated: partialStart || droppedPrefixLength > 0 || firstBreak !== -1,
    totalBytes:
      response.status === 206
        ? (range?.total ?? null)
        : (parseByteCount(response.headers.get('content-length')) ??
          ('totalBytes' in read ? read.totalBytes : read.bytes.byteLength)),
  }
}
