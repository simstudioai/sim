import { randomUUID } from 'node:crypto'
import type {
  Agent,
  AssistantMessage,
  Model,
  Part,
  Project,
  Provider,
  SessionPromptResponse,
} from '@opencode-ai/sdk'
import { db } from '@sim/db'
import { memory } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { createOpenCodeClient } from '@/lib/opencode/client'

const logger = createLogger('OpenCodeService')
const DEFAULT_OPEN_CODE_REPOSITORY_ROOT = '/app/repos'

export interface OpenCodeRepositoryOption {
  id: string
  label: string
  directory: string
  projectId: string
}

export interface OpenCodeProviderOption {
  id: string
  label: string
}

export interface OpenCodeModelOption {
  id: string
  label: string
  providerId: string
}

export interface OpenCodeAgentOption {
  id: string
  label: string
  description?: string
}

export interface OpenCodeStoredSession {
  sessionId: string
  repository: string
  updatedAt: string
}

export interface OpenCodePromptRequest {
  repository: string
  prompt: string
  providerId: string
  modelId: string
  systemPrompt?: string
  agent?: string
  sessionId?: string
  title?: string
}

export interface OpenCodePromptResult {
  content: string
  threadId: string
  cost?: number
  providerId?: string
  modelId?: string
  assistantError?: string
}

export interface OpenCodeMessageItem {
  messageId: string
  role: 'user' | 'assistant'
  content: string
  cost?: number
  providerId?: string
  modelId?: string
  createdAt: number
}

function getOpenCodeRepositoryRoot(): string {
  const configuredRoot = process.env.OPENCODE_REPOSITORY_ROOT?.trim()
  if (!configuredRoot) {
    return DEFAULT_OPEN_CODE_REPOSITORY_ROOT
  }

  if (configuredRoot === '/') {
    return configuredRoot
  }

  return configuredRoot.replace(/\/+$/, '')
}

function stripGitSuffix(value: string): string {
  return value.endsWith('.git') ? value.slice(0, -4) : value
}

function parseConfiguredRepositoryName(repositoryUrl: string): string | null {
  const trimmedUrl = repositoryUrl.trim()
  if (!trimmedUrl) {
    return null
  }

  try {
    const url = new URL(trimmedUrl)
    const segments = url.pathname
      .split('/')
      .map((segment) => segment.trim())
      .filter(Boolean)

    if (segments.length === 0) {
      return null
    }

    return stripGitSuffix(segments[segments.length - 1])
  } catch (error) {
    logger.warn('Failed to parse OpenCode repository URL from OPENCODE_REPOS', {
      repositoryUrl: trimmedUrl,
      error,
    })
    return null
  }
}

function listConfiguredOpenCodeRepositoryNames(): string[] {
  const configuredRepositories = process.env.OPENCODE_REPOS?.split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  if (!configuredRepositories || configuredRepositories.length === 0) {
    return []
  }

  const uniqueRepositories = new Map<string, string>()

  for (const repositoryUrl of configuredRepositories) {
    const repositoryName = parseConfiguredRepositoryName(repositoryUrl)
    if (!repositoryName) {
      continue
    }

    if (uniqueRepositories.has(repositoryName)) {
      logger.warn('Duplicate OpenCode repository name in OPENCODE_REPOS', {
        repositoryName,
        repositoryUrl,
      })
      continue
    }

    uniqueRepositories.set(repositoryName, repositoryUrl)
  }

  return Array.from(uniqueRepositories.keys()).sort((left, right) => left.localeCompare(right))
}

function getRepositoryName(repository: string): string {
  const repositoryRoot = getOpenCodeRepositoryRoot()

  if (repository.startsWith(`${repositoryRoot}/`)) {
    return repository.slice(repositoryRoot.length + 1)
  }

  return repository
}

function buildOpenCodeRepositoryDirectory(repository: string): string {
  return `${getOpenCodeRepositoryRoot()}/${repository}`
}

function isProjectInsideRepositoryRoot(project: Project): boolean {
  return project.worktree.startsWith(`${getOpenCodeRepositoryRoot()}/`)
}

function mapProjectToRepositoryOption(project: Project): OpenCodeRepositoryOption {
  const repository = getRepositoryName(project.worktree)

  return {
    id: repository,
    label: repository,
    directory: buildOpenCodeRepositoryDirectory(repository),
    projectId: project.id,
  }
}

function mapProviderToOption(provider: Provider): OpenCodeProviderOption {
  return {
    id: provider.id,
    label: provider.name,
  }
}

function mapModelToOption(providerId: string, model: Model): OpenCodeModelOption {
  return {
    id: model.id,
    label: model.name || model.id,
    providerId,
  }
}

function mapAgentToOption(agent: Agent): OpenCodeAgentOption {
  return {
    id: agent.name,
    label: agent.name,
    description: agent.description,
  }
}

function getAssistantErrorMessage(error: AssistantMessage['error']): string | undefined {
  if (!error) {
    return undefined
  }

  if ('data' in error && error.data && typeof error.data === 'object' && 'message' in error.data) {
    const message = error.data.message
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }

  return error.name
}

export function extractOpenCodeText(parts: Part[]): string {
  return parts
    .filter((part): part is Extract<Part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join('\n\n')
}

function mapPromptResponseToResult(response: SessionPromptResponse): OpenCodePromptResult {
  return {
    content: extractOpenCodeText(response.parts),
    threadId: response.info.sessionID,
    cost: response.info.cost,
    providerId: response.info.providerID,
    modelId: response.info.modelID,
    assistantError: getAssistantErrorMessage(response.info.error),
  }
}

export async function listOpenCodeRepositories(): Promise<OpenCodeRepositoryOption[]> {
  const client = createOpenCodeClient()
  const projectResult = await client.project.list({ throwOnError: true })
  const projects = projectResult.data
  const configuredRepositories = listConfiguredOpenCodeRepositoryNames()

  if (configuredRepositories.length > 0) {
    const projectsByDirectory = new Map(
      projects
        .filter(isProjectInsideRepositoryRoot)
        .map((project) => [project.worktree, project] as const)
    )

    return configuredRepositories.map((repository) => {
      const directory = buildOpenCodeRepositoryDirectory(repository)
      const project = projectsByDirectory.get(directory)

      return {
        id: repository,
        label: repository,
        directory,
        projectId: project?.id || `configured:${repository}`,
      }
    })
  }

  const repositories = projects
    .filter(isProjectInsideRepositoryRoot)
    .map(mapProjectToRepositoryOption)
    .sort((left, right) => left.label.localeCompare(right.label))

  const uniqueRepositories = new Map<string, OpenCodeRepositoryOption>()
  for (const repository of repositories) {
    uniqueRepositories.set(repository.id, repository)
  }

  return Array.from(uniqueRepositories.values())
}

export async function resolveOpenCodeRepositoryOption(
  repository: string
): Promise<OpenCodeRepositoryOption> {
  const normalizedRepository = repository.trim()
  if (!normalizedRepository) {
    throw new Error('repository is required')
  }

  const repositories = await listOpenCodeRepositories()
  const repositoryOption = repositories.find((item) => item.id === normalizedRepository)

  if (!repositoryOption) {
    throw new Error(`Unknown OpenCode repository: ${normalizedRepository}`)
  }

  return repositoryOption
}

export async function listOpenCodeProviders(
  repository?: string
): Promise<OpenCodeProviderOption[]> {
  const client = createOpenCodeClient()
  const directory = repository
    ? (await resolveOpenCodeRepositoryOption(repository)).directory
    : undefined
  const configResult = await client.config.providers({
    query: directory ? { directory } : undefined,
    throwOnError: true,
  })
  const providers = configResult.data.providers

  return providers
    .map((provider) => mapProviderToOption(provider))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export async function listOpenCodeModels(
  providerId: string,
  repository?: string
): Promise<OpenCodeModelOption[]> {
  const client = createOpenCodeClient()
  const directory = repository
    ? (await resolveOpenCodeRepositoryOption(repository)).directory
    : undefined
  const configResult = await client.config.providers({
    query: directory ? { directory } : undefined,
    throwOnError: true,
  })
  const providers = configResult.data.providers

  const provider = providers.find((item) => item.id === providerId)
  if (!provider) {
    return []
  }

  return Object.values(provider.models)
    .map((model) => mapModelToOption(providerId, model))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export async function listOpenCodeAgents(repository?: string): Promise<OpenCodeAgentOption[]> {
  const client = createOpenCodeClient()
  const directory = repository
    ? (await resolveOpenCodeRepositoryOption(repository)).directory
    : undefined
  const agentResult = await client.app.agents({
    query: directory ? { directory } : undefined,
    throwOnError: true,
  })
  const agents = agentResult.data

  return agents.map(mapAgentToOption).sort((left, right) => left.label.localeCompare(right.label))
}

export async function createOpenCodeSession(
  repository: string,
  title?: string
): Promise<{ id: string }> {
  const client = createOpenCodeClient()
  const repositoryOption = await resolveOpenCodeRepositoryOption(repository)
  const sessionResult = await client.session.create({
    query: { directory: repositoryOption.directory },
    body: title ? { title } : undefined,
    throwOnError: true,
  })

  return { id: sessionResult.data.id }
}

export async function promptOpenCodeSession(
  request: OpenCodePromptRequest
): Promise<OpenCodePromptResult> {
  const client = createOpenCodeClient()
  const repositoryOption = await resolveOpenCodeRepositoryOption(request.repository)
  const directory = repositoryOption.directory
  const sessionId =
    request.sessionId || (await createOpenCodeSession(request.repository, request.title)).id

  const response = await client.session.prompt({
    path: { id: sessionId },
    query: { directory },
    body: {
      parts: [{ type: 'text', text: request.prompt }],
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      ...(request.agent ? { agent: request.agent } : {}),
      model: {
        providerID: request.providerId,
        modelID: request.modelId,
      },
    },
    throwOnError: true,
  })

  return mapPromptResponseToResult(response.data)
}

export async function getOpenCodeMessages(
  repository: string,
  sessionId: string
): Promise<OpenCodeMessageItem[]> {
  const client = createOpenCodeClient()
  const repositoryOption = await resolveOpenCodeRepositoryOption(repository)
  const response = await client.session.messages({
    path: { id: sessionId },
    query: { directory: repositoryOption.directory },
    throwOnError: true,
  })

  return response.data.map((message) => {
    const baseItem = {
      messageId: message.info.id,
      role: message.info.role,
      content: extractOpenCodeText(message.parts),
      createdAt: message.info.time.created,
    }

    if (message.info.role === 'assistant') {
      return {
        ...baseItem,
        cost: message.info.cost,
        providerId: message.info.providerID,
        modelId: message.info.modelID,
      }
    }

    return baseItem
  })
}

export async function getStoredOpenCodeSession(
  workspaceId: string,
  key: string
): Promise<OpenCodeStoredSession | null> {
  const result = await db
    .select({ data: memory.data })
    .from(memory)
    .where(and(eq(memory.workspaceId, workspaceId), eq(memory.key, key), isNull(memory.deletedAt)))
    .limit(1)

  if (result.length === 0) {
    return null
  }

  const data = result[0].data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null
  }

  const sessionId = 'sessionId' in data ? data.sessionId : undefined
  const repository = 'repository' in data ? data.repository : undefined
  const updatedAt = 'updatedAt' in data ? data.updatedAt : undefined

  if (
    typeof sessionId !== 'string' ||
    typeof repository !== 'string' ||
    typeof updatedAt !== 'string'
  ) {
    return null
  }

  return { sessionId, repository, updatedAt }
}

export async function storeOpenCodeSession(
  workspaceId: string,
  key: string,
  value: OpenCodeStoredSession
): Promise<void> {
  const now = new Date()

  await db
    .insert(memory)
    .values({
      id: randomUUID(),
      workspaceId,
      key,
      data: value,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [memory.workspaceId, memory.key],
      set: {
        data: value,
        updatedAt: now,
        deletedAt: null,
      },
    })
}

export function buildOpenCodeSessionMemoryKey(workflowId: string, userKey: string): string {
  return `opencode:session:${workflowId}:${userKey}`
}

export function buildOpenCodeSessionTitle(repository: string, userKey: string): string {
  return `SIMAI ${getRepositoryName(repository)} ${userKey}`
}

export function shouldRetryWithFreshOpenCodeSession(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error)

  const normalized = message.toLowerCase()
  return (
    normalized.includes('404') ||
    normalized.includes('not found') ||
    normalized.includes('session not found') ||
    normalized.includes('session does not exist') ||
    normalized.includes('does not exist')
  )
}

export async function logOpenCodeFailure(message: string, error: unknown): Promise<void> {
  logger.error(message, { error })
}
