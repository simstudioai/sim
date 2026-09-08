'use client'

import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { cn, Expandable, ExpandableContent, SecretReveal, Tooltip, toast } from '@sim/emcn'
import { ArrowRight, Check, ChevronDown, SquareArrowUpRight, TerminalWindow } from '@sim/emcn/icons'
import { isRecordLike } from '@sim/utils/object'
import { useParams } from 'next/navigation'
import { useSession } from '@/lib/auth/auth-client'
import { buildHostedUpgradeUrl, HOSTED_BILLING_SETTINGS_URL } from '@/lib/billing/upgrade-reasons'
import { canManageWorkspaceBilling } from '@/lib/billing/workspace-permissions'
import { isBrowserAgentAvailable, sendBrowserPanelAction } from '@/lib/browser-agent/transport'
import { useDeploymentShape } from '@/lib/core/config/deployment-shape'
import { isSafeHttpUrl } from '@/lib/core/utils/urls'
import { readLatestOAuthChatAttempt } from '@/lib/credentials/oauth-chat-attempt'
import { getDesktopBridge } from '@/lib/desktop'
import { desktopChatScopeId } from '@/lib/desktop/chat-scope'
import { resolveCredentialDisplay } from '@/lib/integrations/credential-display'
import {
  resolveOAuthServiceForSlug,
  resolveServiceAccountIntegration,
} from '@/lib/integrations/oauth-service'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { getServiceConfigByProviderId } from '@/lib/oauth/utils'
import { finishTerminalHandoff, isTerminalAvailable } from '@/lib/terminal/transport'
import { useChatSurface } from '@/app/workspace/[workspaceId]/home/components/chat-surface-context'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import {
  INTERACTION_CARD_ROW_CLASSES,
  InteractionCard,
  InteractionCardActionRow,
  InteractionCardInputRow,
  InteractionCardRecap,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/interaction-card'
import {
  parseQuestionAnswerMessage,
  QuestionDisplay,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import { ResourceMention } from '@/app/workspace/[workspaceId]/home/components/message-content/components/resource-mention'
import {
  resolveOAuthChipTarget,
  useOAuthChipConnection,
} from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/use-oauth-chip-connection'
import { usePersonalCredentialConnection } from '@/app/workspace/[workspaceId]/home/components/message-content/components/special-tags/use-personal-credential-connection'
import type {
  ChatMessageContext,
  MothershipResource,
  WorkspaceResourceRef,
} from '@/app/workspace/[workspaceId]/home/types'
// Deep import, not the barrel: the barrel also re-exports
// ConnectServiceAccountModal, and that edge would pull the modal into this
// chunk and defeat the lazy() split below.
import { useServiceAccountConnectTarget } from '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/use-service-account-connect'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { BrandIcon } from '@/blocks/brand-icon'
import {
  useUpdateWorkspaceCredential,
  useWorkspaceCredential,
  useWorkspaceCredentials,
} from '@/hooks/queries/credentials'
import {
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { findWorkspaceFileByPath } from '@/hooks/queries/utils/find-workspace-file-by-src'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

export interface OptionsItemData {
  title: string
  description: string
}

export type OptionsTagData = Record<string, OptionsItemData>

export const USAGE_UPGRADE_ACTIONS = ['upgrade_plan', 'increase_limit'] as const

export type UsageUpgradeAction = (typeof USAGE_UPGRADE_ACTIONS)[number]

/**
 * Synthetic inline tag payload derived from request-layer HTTP upgrade/quota
 * failures and rendered through the same special-tag abstraction as streamed tags.
 */
export interface UsageUpgradeTagData {
  reason: string
  action: UsageUpgradeAction
  message: string
}

/**
 * Kept out of the chat's initial chunk — it pulls in three provider-specific
 * setup forms and is only mounted once a message actually offers a service
 * account.
 */
const ConnectServiceAccountModal = lazy(() =>
  import(
    '@/app/workspace/[workspaceId]/integrations/components/connect-service-account-modal/connect-service-account-modal'
  ).then((m) => ({ default: m.ConnectServiceAccountModal }))
)

const ConnectPersonalTokenModal = lazy(() =>
  import('@/app/workspace/[workspaceId]/integrations/components/connect-personal-token-modal').then(
    (module) => ({ default: module.ConnectPersonalTokenModal })
  )
)

export const CREDENTIAL_TAG_TYPES = [
  'env_key',
  'oauth_key',
  'sim_key',
  'credential_id',
  'link',
  'secret_input',
  'folder_access',
  'browser_takeover',
  'terminal_handoff',
  'service_account',
] as const

export type CredentialTagType = (typeof CREDENTIAL_TAG_TYPES)[number]

export const SECRET_INPUT_SCOPES = ['personal', 'workspace'] as const

export type SecretInputScope = (typeof SECRET_INPUT_SCOPES)[number]

export interface CredentialItemData {
  value?: string
  type: CredentialTagType
  provider?: string
  /**
   * Env-var key name to save the pasted secret under (secret_input), e.g.
   * "OPENAI_API_KEY"; the folder hint for folder_access; the takeover reason
   * for browser_takeover; what the user needs to do for terminal_handoff.
   */
  name?: string
  /** Where a secret_input value is persisted. Defaults to "workspace". */
  scope?: SecretInputScope
  /**
   * What the secret is for (secret_input, workspace scope only), written by the
   * agent that asked for it. Never shown or editable in the card — it exists so
   * the saved secret carries its purpose into workspace settings.
   */
  description?: string
  /**
   * Existing credential to reconnect in place (service_account only). Present =
   * rotate the secret on this credential; absent = create a new one.
   */
  credentialId?: string
}

/**
 * Normalized `<credential>` payload. A singleton object remains valid for old
 * messages, while an array lets one terminal tag render several controls as
 * rows in a single card.
 */
export type CredentialTagData = CredentialItemData[]

export interface CredentialSubmissionProgress {
  connectedIntegrationIndexes: ReadonlySet<number>
  savedSecretIndexes: ReadonlySet<number>
}

export interface CredentialSubmissionPayload {
  integrations: Array<{ name: string; status: 'connected' | 'skipped' }>
  secrets: Array<{ name: string; status: 'saved' | 'skipped' }>
}

/**
 * Safe user-turn payload emitted by the credential question card. It carries
 * only the requested provider and environment-variable names; secret values
 * remain in Sim's credential stores and never enter the transcript.
 */
export function formatCredentialSubmissionMessage(
  data: CredentialTagData,
  progress?: CredentialSubmissionProgress
): string {
  const integrations = data
    .filter((item) => item.type === 'link' || item.type === 'service_account')
    .map((item) => item.provider?.trim())
    .filter((provider): provider is string => Boolean(provider))
  const secrets = data
    .filter((item) => item.type === 'secret_input')
    .map((item) => item.name?.trim())
    .filter((name): name is string => Boolean(name))
  const payload: CredentialSubmissionPayload = {
    integrations: integrations.map((name, index) => ({
      name,
      status:
        !progress || progress.connectedIntegrationIndexes.has(index) ? 'connected' : 'skipped',
    })),
    secrets: secrets.map((name, index) => ({
      name,
      status: !progress || progress.savedSecretIndexes.has(index) ? 'saved' : 'skipped',
    })),
  }
  return `Credential setup submitted — ${JSON.stringify(payload)}`
}

export function parseCredentialSubmissionProgress(
  data: CredentialTagData,
  content: string
): CredentialSubmissionPayload | null {
  const legacyIntegrations = data
    .filter((item) => item.type === 'link' || item.type === 'service_account')
    .map((item) => item.provider?.trim())
    .filter((provider): provider is string => Boolean(provider))
  const legacySecrets = data
    .filter((item) => item.type === 'secret_input')
    .map((item) => item.name?.trim())
    .filter((name): name is string => Boolean(name))
  const legacyParts = [
    legacyIntegrations.length > 0 ? `integrations: ${legacyIntegrations.join(', ')}` : null,
    legacySecrets.length > 0 ? `secrets: ${legacySecrets.join(', ')}` : null,
  ].filter((part): part is string => part !== null)
  const legacyMessage = `Credential setup complete${legacyParts.length > 0 ? ` — ${legacyParts.join('; ')}` : ''}`
  if (content === legacyMessage) {
    return {
      integrations: legacyIntegrations.map((name) => ({ name, status: 'connected' })),
      secrets: legacySecrets.map((name) => ({ name, status: 'saved' })),
    }
  }

  const prefix = 'Credential setup submitted — '
  if (!content.startsWith(prefix)) return null

  try {
    const payload = JSON.parse(content.slice(prefix.length)) as CredentialSubmissionPayload
    const expectedIntegrations = data
      .filter((item) => item.type === 'link' || item.type === 'service_account')
      .map((item) => item.provider?.trim())
      .filter((provider): provider is string => Boolean(provider))
    const expectedSecrets = data
      .filter((item) => item.type === 'secret_input')
      .map((item) => item.name?.trim())
      .filter((name): name is string => Boolean(name))

    const valid =
      Array.isArray(payload.integrations) &&
      payload.integrations.length === expectedIntegrations.length &&
      payload.integrations.every(
        (item, index) =>
          item.name === expectedIntegrations[index] &&
          (item.status === 'connected' || item.status === 'skipped')
      ) &&
      Array.isArray(payload.secrets) &&
      payload.secrets.length === expectedSecrets.length &&
      payload.secrets.every(
        (item, index) =>
          item.name === expectedSecrets[index] &&
          (item.status === 'saved' || item.status === 'skipped')
      )
    return valid ? payload : null
  } catch {
    return null
  }
}

export function parseCredentialSubmissionMessage(
  data: CredentialTagData,
  content: string
): boolean {
  return parseCredentialSubmissionProgress(data, content) !== null
}

export interface MothershipErrorTagData {
  message: string
  code?: string
  provider?: string
}

export interface FileTagData {
  name: string
  type: string
  content: string
}

export const QUESTION_TYPES = ['single_select', 'multi_select'] as const

export type QuestionType = (typeof QUESTION_TYPES)[number]

export interface QuestionOption {
  id: string
  label: string
}

/**
 * One question in a `<question>` tag: a single_select or multi_select with at
 * least one real option. The card always appends its own free-text "Something
 * else" row, so agent-supplied catch-all options ("Other", "Something else",
 * ...) are stripped during parsing.
 */
export interface QuestionItem {
  type: QuestionType
  prompt: string
  options: QuestionOption[]
}

/** Normalized `<question>` payload: single-object bodies become a one-element array. */
export type QuestionTagData = QuestionItem[]

export const WORKSPACE_RESOURCE_TAG_TYPES = ['workflow', 'table', 'file'] as const

export type WorkspaceResourceTagType = (typeof WORKSPACE_RESOURCE_TAG_TYPES)[number]

export interface WorkspaceResourceTagData {
  type: WorkspaceResourceTagType
  id?: string
  path?: string
  title?: string
}

/**
 * A `<source>` tag: one document the reply drew on. The tag contract for
 * search answers — the model emits it inline, right after the sentence, list
 * item, or paragraph the document supports, as a JSON body:
 *
 * `<source>{"url":"https://docs.github.com/…","siteName":"GitHub Docs"}</source>`
 *
 * Each tag renders as its own small chip where it sits (adjacent tags are
 * never collapsed into a count), and every distinct `url` in the message is
 * repeated in the footer strip below the reply.
 */
export interface SourceTagData {
  /** Canonical http(s) link to the referenced document. */
  url: string
  /** Document title, shown on hover. */
  title?: string
  /**
   * Short chip label — the site or product the document lives in ("GitHub
   * Docs", "Confluence"). Falls back to the URL's hostname.
   */
  siteName?: string
  /**
   * Knowledge-base connector the document was synced through
   * (`CONNECTOR_META_REGISTRY` key). Lends the chip the product's brand mark;
   * without it the chip shows the site favicon.
   */
  connectorType?: string
  /** The passage the reply relied on; a reply whose sources carry one is listed as result cards. */
  snippet?: string
  /** When the source last changed the document, as an ISO timestamp. */
  updatedAt?: string
  /** The person behind the document, as the source names them. */
  author?: string
}

export type ContentSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'options'; data: OptionsTagData }
  | { type: 'usage_upgrade'; data: UsageUpgradeTagData }
  | { type: 'credential'; data: CredentialTagData }
  | { type: 'mothership-error'; data: MothershipErrorTagData }
  | { type: 'workspace_resource'; data: WorkspaceResourceTagData }
  | { type: 'question'; data: QuestionTagData }
  | { type: 'source'; data: SourceTagData }

export type RuntimeSpecialTagName =
  | 'thinking'
  | 'options'
  | 'credential'
  | 'mothership-error'
  | 'file'
  | 'workspace_resource'
  | 'question'
  | 'source'

export interface ParsedSpecialContent {
  segments: ContentSegment[]
  hasPendingTag: boolean
}

const RUNTIME_SPECIAL_TAG_NAMES = [
  'thinking',
  'options',
  'credential',
  'mothership-error',
  'file',
  'workspace_resource',
  'question',
  'source',
] as const

/**
 * Every tag the parser resolves. Exported so tests can assert their fixtures
 * cover all of them rather than hand-picking a subset that silently drifts —
 * the same treatment the sibling `*_TYPES` unions above already get.
 */
export const SPECIAL_TAG_NAMES = [
  'thinking',
  'options',
  'usage_upgrade',
  'credential',
  'mothership-error',
  'workspace_resource',
  'question',
  'source',
] as const

function isOptionsItemData(value: unknown): value is OptionsItemData {
  if (!isRecordLike(value)) return false
  return typeof value.title === 'string' && typeof value.description === 'string'
}

/**
 * Repairs the one malformed options payload seen in the wild: the LAST entry
 * loses its object braces, so its title lands directly on the numeric key and
 * its description is hoisted to a sibling of the entries —
 *
 *   {"1": {…}, "2": {…}, "3": "Third title", "description": "Third desc"}
 *
 * — which fails both the per-item shape check and the numeric-key gate, so the
 * whole card was dropped and the raw JSON rendered as prose.
 *
 * Deliberately narrow: a bare string is only accepted under a numeric key, and
 * only a single stray `description` is absorbed, attaching to the last numeric
 * entry that lacks one. Anything else is returned untouched so a JSON object
 * quoted in prose still cannot masquerade as an options card. Returns the input
 * unchanged when there is nothing to repair.
 */
/** Whether keys are exactly "1".."N" in order, the shape the options contract emits. */
function isSequentialOptionKeys(keys: string[]): boolean {
  return keys.length > 0 && keys.every((key, index) => key === String(index + 1))
}

function repairFlattenedOptionEntry(value: unknown): unknown {
  if (!isRecordLike(value) || Array.isArray(value)) return value

  const entries = Object.entries(value)
  const numericKeys = entries.filter(([key]) => /^\d+$/.test(key))
  if (numericKeys.length === 0) return value

  // The hoisted description IS the signature of this corruption. Without one,
  // a numeric-keyed map of plain strings is just data ({"1": "ok", "2": "ok"})
  // and must stay prose.
  const strayKeys = entries.filter(([key]) => !/^\d+$/.test(key))
  if (strayKeys.length !== 1) return value
  const [strayKey, strayValue] = strayKeys[0]
  if (strayKey !== 'description' || typeof strayValue !== 'string') return value

  // Exactly one entry lost its braces, and it is the last one — every earlier
  // entry must already be a well-formed option.
  const flattenedCount = numericKeys.filter(([, item]) => typeof item === 'string').length
  if (flattenedCount !== 1) return value
  const [lastKey, lastItem] = numericKeys[numericKeys.length - 1]
  if (typeof lastItem !== 'string') return value

  const repaired: Record<string, unknown> = {}
  for (const [key, item] of numericKeys) {
    repaired[key] = key === lastKey ? { title: lastItem, description: strayValue } : item
  }
  return repaired
}

/**
 * Arrays are accepted alongside keyed objects: an agent that emits
 * `<options>[{title,description},…]</options>` still renders, with the array
 * index standing in as the option key.
 */
function isOptionsTagData(value: unknown): value is OptionsTagData {
  if (!isRecordLike(value) && !Array.isArray(value)) return false
  return Object.values(value).every(isOptionsItemData)
}

function isUsageUpgradeTagData(value: unknown): value is UsageUpgradeTagData {
  if (!isRecordLike(value)) return false
  return (
    typeof value.reason === 'string' &&
    typeof value.message === 'string' &&
    typeof value.action === 'string' &&
    (USAGE_UPGRADE_ACTIONS as readonly string[]).includes(value.action)
  )
}

function isCredentialItemData(value: unknown): value is CredentialItemData {
  if (!isRecordLike(value)) return false
  if (
    typeof value.type !== 'string' ||
    !(CREDENTIAL_TAG_TYPES as readonly string[]).includes(value.type)
  ) {
    return false
  }
  if (value.provider !== undefined && typeof value.provider !== 'string') return false
  // secret_input is an empty input the user fills in — it carries a key name to
  // save under, not a value.
  if (value.type === 'secret_input') {
    if (
      value.scope !== undefined &&
      !(SECRET_INPUT_SCOPES as readonly string[]).includes(value.scope as string)
    ) {
      return false
    }
    return typeof value.name === 'string' && value.name.trim().length > 0
  }
  // folder_access, browser_takeover and terminal_handoff are value-less action
  // chips (optional `name` carries the folder hint / reason).
  if (
    value.type === 'folder_access' ||
    value.type === 'browser_takeover' ||
    value.type === 'terminal_handoff'
  ) {
    return value.name === undefined || typeof value.name === 'string'
  }

  // A service_account tag is a control, not a value: it names the provider
  // whose setup form to open, and the user types the secret into that form —
  // so it never carries a `value`, but it is useless without a provider. An
  // optional `credentialId` reconnects an existing service account in place;
  // reject a blank one, since the renderer treats a truthy id as "reconnect"
  // and would try to rotate a non-existent credential.
  if (value.type === 'service_account') {
    if (value.credentialId !== undefined) {
      if (typeof value.credentialId !== 'string' || value.credentialId.trim().length === 0) {
        return false
      }
    }
    return typeof value.provider === 'string' && value.provider.trim().length > 0
  }
  if (value.type === 'link' && value.value === undefined) {
    return typeof value.provider === 'string' && value.provider.trim().length > 0
  }
  // A sim_key chip is platform-filled: the model only marks where the workspace
  // API key belongs (it never holds the value) and Sim injects it from the tool
  // result, so the tag is valid with or without a `value`.
  if (value.type === 'sim_key') return true
  return typeof value.value === 'string'
}

/**
 * Parses a `<credential>` body and normalizes a singleton object to one row.
 * Empty arrays and arrays containing one invalid control reject the whole card.
 */
export function parseCredentialTagBody(body: string): CredentialTagData | null {
  try {
    const parsed = JSON.parse(body) as unknown
    const items = Array.isArray(parsed) ? parsed : [parsed]
    return items.length > 0 && items.every(isCredentialItemData) ? items : null
  } catch {
    return null
  }
}

/** Last complete credential batch, used to pair its Submit turn on reload. */
export function parseLastCredentialTag(content: string): CredentialTagData | null {
  const matches = content.match(/<credential>([\s\S]*?)<\/credential>/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  return parseCredentialTagBody(last.slice('<credential>'.length, -'</credential>'.length))
}

function isMothershipErrorTagData(value: unknown): value is MothershipErrorTagData {
  if (!isRecordLike(value)) return false
  return (
    typeof value.message === 'string' &&
    (value.code === undefined || typeof value.code === 'string') &&
    (value.provider === undefined || typeof value.provider === 'string')
  )
}

/**
 * Only an absolute http(s) URL with a host can be linked; anything else is not
 * a source. Parsed rather than pattern-matched so a malformed value such as
 * `https://?` — which a prefix check would accept — never becomes a dead link.
 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || /\s/.test(value)) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

function isSourceTagData(value: unknown): value is SourceTagData {
  if (!isRecordLike(value)) return false
  if (!isHttpUrl(value.url)) return false
  if (value.title !== undefined && typeof value.title !== 'string') return false
  if (value.siteName !== undefined && typeof value.siteName !== 'string') return false
  if (value.connectorType !== undefined && typeof value.connectorType !== 'string') return false
  if (value.snippet !== undefined && typeof value.snippet !== 'string') return false
  if (value.updatedAt !== undefined && typeof value.updatedAt !== 'string') return false
  if (value.author !== undefined && typeof value.author !== 'string') return false
  return true
}

function isWorkspaceResourceTagData(value: unknown): value is WorkspaceResourceTagData {
  if (!isRecordLike(value)) return false
  if (
    typeof value.type !== 'string' ||
    !(WORKSPACE_RESOURCE_TAG_TYPES as readonly string[]).includes(value.type)
  ) {
    return false
  }
  if (value.title !== undefined && typeof value.title !== 'string') return false
  if (value.path !== undefined && typeof value.path !== 'string') return false
  if (value.id !== undefined && typeof value.id !== 'string') return false

  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const path = typeof value.path === 'string' ? value.path.trim() : ''
  if (value.type === 'file') return id.length > 0 || path.length > 0
  return id.length > 0
}

function isQuestionOption(value: unknown): value is QuestionOption {
  if (!isRecordLike(value)) return false
  return typeof value.id === 'string' && typeof value.label === 'string'
}

/**
 * Catch-all labels the agent must not supply as options — the card renders
 * its own free-text "Something else" row. Matching options are stripped; a
 * question left with no real options is invalid.
 */
const SELF_PROVIDED_OPTION_LABELS = new Set([
  'other',
  'others',
  'something else',
  'none of the above',
  'none of these',
])

function isQuestionItem(value: unknown): value is QuestionItem {
  if (!isRecordLike(value)) return false
  if (
    typeof value.type !== 'string' ||
    !(QUESTION_TYPES as readonly string[]).includes(value.type)
  ) {
    return false
  }
  if (typeof value.prompt !== 'string' || value.prompt.trim().length === 0) return false
  return (
    Array.isArray(value.options) &&
    value.options.length > 0 &&
    value.options.every(isQuestionOption)
  )
}

/** Strips agent-supplied catch-all options; null when none remain. */
function sanitizeQuestionItem(item: QuestionItem): QuestionItem | null {
  const options = item.options.filter(
    (option) => !SELF_PROVIDED_OPTION_LABELS.has(option.label.trim().toLowerCase())
  )
  if (options.length === 0) return null
  return options.length === item.options.length ? item : { ...item, options }
}

/**
 * Parses a `<question>` tag body. Accepts a single question object or a
 * non-empty array of them; single objects are normalized to a one-element
 * array so the renderer only handles the array shape.
 */
/**
 * Extracts the last complete `<question>` tag payload from raw message
 * content. Used by the chat list to pair an assistant question card with the
 * user message that answered it.
 */
export function parseLastQuestionTag(content: string): QuestionTagData | null {
  const matches = content.match(/<question>([\s\S]*?)<\/question>/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  return parseQuestionTagBody(last.slice('<question>'.length, -'</question>'.length))
}

/**
 * Recovers the question text from a `<question>` body that failed validation.
 * A well-formed tag with an invalid body renders as nothing, which silently
 * drops the question the assistant was blocking on and leaves the message
 * looking truncated. The prompts are still answerable in the chat input, so
 * surfacing them as plain text degrades to a prose question instead of losing
 * it. A body that is not even parseable JSON has nothing to recover.
 */
function recoverQuestionPrompts(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as unknown
    const items = Array.isArray(parsed) ? parsed : [parsed]
    const prompts = items
      .filter(isRecordLike)
      .map((item) => (typeof item.prompt === 'string' ? item.prompt.trim() : ''))
      .filter((prompt) => prompt.length > 0)
    return prompts.length > 0 ? prompts.join('\n\n') : null
  } catch {
    return null
  }
}

export function parseQuestionTagBody(body: string): QuestionTagData | null {
  try {
    const parsed = JSON.parse(body) as unknown
    const items = Array.isArray(parsed) ? parsed : [parsed]
    if (items.length === 0 || !items.every(isQuestionItem)) return null
    const sanitized: QuestionItem[] = []
    for (const item of items) {
      const clean = sanitizeQuestionItem(item)
      if (!clean) return null
      sanitized.push(clean)
    }
    return sanitized
  } catch {
    return null
  }
}

export function parseJsonTagBody<T>(
  body: string,
  isExpectedShape: (value: unknown) => value is T,
  /** Optional normalizer applied before the shape check, for known model typos. */
  repair?: (value: unknown) => unknown
): T | null {
  try {
    const parsed = JSON.parse(body) as unknown
    const candidate = repair ? repair(parsed) : parsed
    return isExpectedShape(candidate) ? candidate : null
  } catch {
    return null
  }
}

export function parseTextTagBody(body: string): string | null {
  return body.trim() ? body : null
}

/**
 * Whether `body` is syntactically valid JSON, regardless of its shape.
 *
 * Separates "the agent formed a well-formed payload that failed its shape
 * guard" (`wrong-shape`) from "this body will not parse"; for the latter,
 * {@link wasAttemptedPayload} then decides whether it may be dropped or must be
 * shown (see {@link classifyBody}). Costs a second parse of a body that already
 * failed one, which is the rare path; the common cases never reach it, since a
 * valid payload returns earlier and prose is rejected by the cheaper viability
 * rule before this runs.
 */
function isParseableJson(body: string): boolean {
  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
}

export function parseTagAttributes(openTag: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  const attributePattern = /([A-Za-z_:][A-Za-z0-9_:-]*)="([^"]*)"/g

  let match: RegExpExecArray | null = null
  while ((match = attributePattern.exec(openTag)) !== null) {
    attributes[match[1]] = match[2]
  }

  return attributes
}

export function parseFileTag(openTag: string, body: string): FileTagData | null {
  const attributes = parseTagAttributes(openTag)
  if (!attributes.name || !attributes.type) return null
  return {
    name: attributes.name,
    type: attributes.type,
    content: body,
  }
}

function parseSpecialTagData(
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  body: string
):
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'options'; data: OptionsTagData }
  | { type: 'usage_upgrade'; data: UsageUpgradeTagData }
  | { type: 'credential'; data: CredentialTagData }
  | { type: 'mothership-error'; data: MothershipErrorTagData }
  | { type: 'workspace_resource'; data: WorkspaceResourceTagData }
  | { type: 'question'; data: QuestionTagData }
  | { type: 'source'; data: SourceTagData }
  | null {
  if (tagName === 'thinking') {
    const content = parseTextTagBody(body)
    return content ? { type: 'thinking', content } : null
  }

  if (tagName === 'options') {
    const data = parseJsonTagBody(body, isOptionsTagData, repairFlattenedOptionEntry)
    return data ? { type: 'options', data } : null
  }

  if (tagName === 'usage_upgrade') {
    const data = parseJsonTagBody(body, isUsageUpgradeTagData)
    return data ? { type: 'usage_upgrade', data } : null
  }

  if (tagName === 'credential') {
    const data = parseCredentialTagBody(body)
    return data ? { type: 'credential', data } : null
  }

  if (tagName === 'mothership-error') {
    const data = parseJsonTagBody(body, isMothershipErrorTagData)
    return data ? { type: 'mothership-error', data } : null
  }

  if (tagName === 'workspace_resource') {
    const data = parseJsonTagBody(body, isWorkspaceResourceTagData)
    return data ? { type: 'workspace_resource', data } : null
  }

  if (tagName === 'source') {
    const data = parseJsonTagBody(body, isSourceTagData)
    return data ? { type: 'source', data } : null
  }

  if (tagName === 'question') {
    const data = parseQuestionTagBody(body)
    if (data) return { type: 'question', data }
    const recovered = recoverQuestionPrompts(body)
    return recovered ? { type: 'text', content: recovered } : null
  }

  return null
}

/**
 * Any tag-shaped marker, including names that are not special tags at all — the
 * model inventing `</workflow_resource>` is exactly the case that matters.
 */
const TAG_SHAPED_MARKER = /<\/?[a-zA-Z][\w-]*>/

/**
 * The one tag whose body is prose rather than JSON (see {@link parseTextTagBody}),
 * so a non-JSON body there says nothing about whether a close is still coming.
 */
const PROSE_BODY_TAG_NAME: (typeof SPECIAL_TAG_NAMES)[number] = 'thinking'

/**
 * Tags whose body must be JSON.
 *
 * Derived from {@link SPECIAL_TAG_NAMES} rather than hand-listed: a new tag is
 * JSON-bodied by default, so forgetting to update this set cannot silently
 * downgrade it to the weaker prose heuristics. Opting a tag out is an explicit
 * edit to {@link PROSE_BODY_TAG_NAME}.
 */
const JSON_BODY_TAG_NAMES: ReadonlySet<(typeof SPECIAL_TAG_NAMES)[number]> = new Set(
  SPECIAL_TAG_NAMES.filter((name) => name !== PROSE_BODY_TAG_NAME)
)

/**
 * How much of a body to inspect per parse, on both the unclosed and matched-pair
 * paths.
 *
 * The rules in {@link unclosedTagCannotResolve} and {@link literalTextReason}
 * decide on their FIRST piece of evidence — the first foreign marker, or the
 * first character that breaks JSON viability — so a bounded window reaches the
 * same verdict as the full remainder for any payload a tag actually carries.
 * Unbounded, the check is O(body length) and runs once per opener inside a parse
 * that re-runs for every streamed chunk. A long reply repeatedly mentioning a
 * tag name, or one whose misspelled early close stretches a single body across
 * most of the message, is then quadratic in the length of the reply.
 *
 * The window's one blind spot, and why it is accepted: a JSON body whose
 * top-level value closes BEYOND the window, followed by prose and no closing tag,
 * still reads as a viable prefix, so the remainder stays hidden until the stream
 * ends rather than settling mid-stream. It is lossless — the completed parse
 * renders every character — and it needs a payload several times larger than any
 * tag emits (a `<workspace_resource>` runs ~100 characters, a `<question>` card
 * under ~1500). A mention in prose settles at its first character at any length,
 * because prose does not open with `{`. Widening or removing the window to close
 * that gap would trade a measured, reachable main-thread freeze for a
 * hypothetical one.
 */
const MAX_UNCLOSED_BODY_SCAN = 4096

/**
 * Length of the longest marker the scans can match.
 *
 * Derived from {@link SPECIAL_TAG_NAMES} rather than hand-counted, so adding a
 * longer tag name cannot silently shrink the rewind in {@link resumeForClass}.
 * Closing markers are the longer of the two forms, so they set the bound.
 */
const LONGEST_TAG_MARKER = Math.max(...SPECIAL_TAG_NAMES.map((name) => `</${name}>`.length))

/**
 * Strip the contents of JSON string literals from `body`, replacing them with
 * spaces so every other index is preserved.
 *
 * A JSON tag body can legitimately quote tag syntax — a `<question>` asking
 * which tag to use, or a `<workspace_resource>` whose title mentions one. Those
 * markers live inside a string and say nothing about whether the tag will
 * close, so the nesting rule must not see them. Tracks escapes so a `\"` inside
 * a string does not end it early. Handles an unterminated trailing string, which
 * is the normal state mid-stream.
 *
 * Index preservation is load-bearing, not decorative: {@link resumeForClass} takes an
 * offset found in the blanked copy and applies it to the RAW body. Iteration is by
 * code point, so a blanked astral character must emit `char.length` spaces —
 * emitting one would shrink the output and shift every later offset left.
 */
function blankJsonStringLiterals(body: string): string {
  // With no quote there is no string literal, so the loop below would copy the
  // body to itself character by character. Callers reach here on bodies that
  // are usually plain prose, and this runs per opener per streamed chunk.
  if (!body.includes('"')) return body

  let out = ''
  let inString = false
  let escaped = false

  for (const char of body) {
    if (escaped) {
      escaped = false
      out += ' '.repeat(char.length)
      continue
    }
    if (char === '\\' && inString) {
      escaped = true
      out += ' '
      continue
    }
    if (char === '"') {
      inString = !inString
      out += '"'
      continue
    }
    out += inString ? ' '.repeat(char.length) : char
  }

  return out
}

/**
 * Whether `body` ends inside a JSON string literal, under the same quote and
 * escape rules as {@link blankJsonStringLiterals}.
 *
 * True means the body's quotes are mispaired, so blanking assigned at least one
 * region to the wrong side of a string boundary — the one condition under which
 * a marker missing from the blanked copy may still be real. With balanced
 * quotes the blanked scan already saw every marker outside a string, so a
 * marker visible only in the raw text really was quoted content (see
 * {@link classifyBody}).
 */
function endsInsideJsonString(body: string): boolean {
  let inString = false
  let escaped = false
  for (let i = 0; i < body.length; i++) {
    const char = body[i]
    if (escaped) {
      escaped = false
    } else if (char === '\\' && inString) {
      escaped = true
    } else if (char === '"') {
      inString = !inString
    }
  }
  return inString
}

/**
 * True while `scannable` could still grow into a single valid JSON value.
 *
 * Checking only the first character is not enough: a body like
 * `{"type":"file"}</workspac and then prose...` opens with `{` and looks fine,
 * but the value CLOSES at the `}` and everything after it is fatal. Tracking
 * depth catches that the moment the stray character arrives, instead of waiting
 * for a close tag that is never coming.
 *
 * Takes a body whose string literals are ALREADY blanked by
 * {@link blankJsonStringLiterals}, so braces and brackets inside JSON strings do
 * not affect the depth count. Both callers blank the body for their own marker
 * scan first, so taking the blanked form avoids a second pass over the same text.
 */
function isViableJsonPrefixOf(scannable: string): boolean {
  if (scannable.trim() === '') return true

  const firstChar = scannable.trimStart().charAt(0)
  if (firstChar !== '{' && firstChar !== '[') return false

  let depth = 0
  for (let i = 0; i < scannable.length; i++) {
    const char = scannable[i]
    if (char === '{' || char === '[') {
      depth++
    } else if (char === '}' || char === ']') {
      depth--
      if (depth < 0) return false
      // The top-level value just closed: only trailing whitespace may follow.
      if (depth === 0) return scannable.slice(i + 1).trim() === ''
    }
  }

  return true
}

/**
 * Index just past the close of `scannable`'s top-level JSON value, or -1 while
 * the value is still open. Same depth rules as {@link isViableJsonPrefixOf},
 * and takes the same blanked form, so braces inside JSON strings do not count.
 */
function jsonValueEndIn(scannable: string): number {
  let depth = 0
  for (let i = 0; i < scannable.length; i++) {
    const char = scannable[i]
    if (char === '{' || char === '[') {
      depth++
    } else if (char === '}' || char === ']') {
      depth--
      if (depth <= 0) return i + 1
    }
  }
  return -1
}

/**
 * Nothing but JSON punctuation and whitespace — what a fumbled payload's tail
 * looks like on the BLANKED body, where string contents are already spaces. A
 * letter or digit here means the model moved on to prose instead (see
 * {@link resolveTagAt}).
 */
const JSON_DEBRIS_ONLY = /^[\s[\]{}",:]*$/

/**
 * Whether `text` contains a marker for one of the tags this parser knows.
 *
 * Deliberately the tag NAMES rather than anything tag-shaped. A prose body may
 * legitimately contain `<div>` or `Promise<void>`; only a marker the parser
 * would itself act on proves the enclosing opener was text. Shared so the
 * streaming and matched-pair paths cannot answer the same question differently
 * — them disagreeing is what let a late close swallow content already on screen.
 *
 * The match is by substring, so a generic is safe only when its parameter is not
 * itself a tag name: `Promise<void>` does not match, `Promise<options>` does. The
 * narrowing is not worth its cost — it needs a `<thinking>` body, which the agent
 * no longer emits (reasoning arrives as structured thinking blocks), discussing a
 * type named exactly after a tag; and the boundary check that would fix it wants a
 * lookbehind, unavailable on the Safari versions this app still supports.
 */
function hasSpecialTagMarker(text: string): boolean {
  return SPECIAL_TAG_NAMES.some((name) => text.includes(`</${name}>`) || text.includes(`<${name}>`))
}

/**
 * True when an opening tag with no close yet can NEVER resolve, so the text
 * after it should be shown immediately instead of held back until the stream
 * ends. Without it, a message that merely mentions a tag in prose goes blank
 * from that point on until streaming stops.
 *
 * One rule decides it, chosen by body kind:
 *
 * - **JSON-bodied tags** must stay a viable JSON prefix. Depth is tracked rather
 *   than testing the first character alone, so a body whose top-level value has
 *   already closed is caught the moment stray content follows it — a mention in
 *   prose (no `{` at all), a misspelled close like `</workflow_resource>`, a
 *   truncated `</workspac`, or no close whatsoever.
 * - **The prose-bodied tag** has no JSON to test, so the only evidence available
 *   is that tags never nest: a marker for another special tag in the body means
 *   this opener was literal text.
 *
 * Nested markers are NOT scanned for on a JSON body. A marker outside a string
 * literal is content the viability rule already rejects, and one inside is
 * legitimate quoted syntax that must not count as evidence — so the scan cost a
 * pass per tag name, open and close, to catch nothing.
 *
 * Both rules are conservative: they fire only on content that could not have
 * parsed. A false positive merely shows text early that a later chunk resolves
 * into a tag, and the end-of-stream parse still renders correctly.
 */
function unclosedTagCannotResolve(
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  body: string
): boolean {
  const pending = dropArrivingClose(body, `</${tagName}>`)

  if (!JSON_BODY_TAG_NAMES.has(tagName)) return hasSpecialTagMarker(pending)

  // Cheap rejection before the expensive one. isViableJsonPrefixOf decides on
  // the first non-whitespace character when it is not `{` or `[` — which is the
  // common case, a tag name mentioned in prose — so testing it here avoids
  // blanking up to a full window of text only to throw the copy away.
  const firstChar = pending.trimStart().charAt(0)
  if (firstChar !== '' && firstChar !== '{' && firstChar !== '[') return true

  // Blank string literals first so braces and brackets inside JSON strings do
  // not throw off the depth count.
  return !isViableJsonPrefixOf(blankJsonStringLiterals(pending))
}

/**
 * Drop a trailing fragment that could still grow into `closeTag`.
 *
 * Mid-stream the closing marker arrives a character at a time, so a body sits at
 * `]</opt` for several frames before `</options>` completes. That fragment is an
 * arriving close, not stray content — counting it as fatal is what made a
 * perfectly valid tag show its raw payload as text until the final `>` landed.
 *
 * Only a fragment at the very END is dropped, so evidence that the close is
 * genuinely wrong still lands immediately: a misspelled `</workflow_resource>`
 * is not a prefix of `</workspace_resource>`, and a truncated `</workspac`
 * followed by prose stops being one the moment the prose arrives.
 */
function dropArrivingClose(body: string, closeTag: string): string {
  for (let n = Math.min(closeTag.length - 1, body.length); n > 0; n--) {
    if (body.endsWith(closeTag.slice(0, n))) return body.slice(0, -n)
  }
  return body
}

/**
 * How one opening tag resolved. Naming the four outcomes is the point: the
 * parser previously decided each case inline, which is how "drop it" quietly
 * became the fallback for situations that were never malformed payloads.
 */
type TagResolution =
  /** Body parsed; emit the typed segment and resume after the closing tag. */
  | { outcome: 'segment'; segment: ContentSegment; resumeAt: number }
  /** Provably not a tag; render the span verbatim and resume after it. */
  | { outcome: 'literal'; resumeAt: number }
  /** A payload the agent attempted and botched — dropped deliberately. */
  | { outcome: 'discard'; resumeAt: number }
  /** Still streaming and a close remains plausible; suppress the remainder. */
  | { outcome: 'pending' }

/**
 * Mechanical evidence about a failed body — named for what was OBSERVED, never
 * for what it means. The semantic conclusion (attempted payload vs prose) is
 * drawn in {@link classifyBody}, which refines `not-viable-json` through
 * {@link wasAttemptedPayload}. `null` means the body parsed as JSON and simply
 * failed its shape guard.
 *
 * The two reasons lead to different resumes, which is why they are
 * distinguished rather than collapsed into a boolean (see {@link resumeForClass}).
 */
type LiteralTextVerdict =
  /**
   * The body carries a tag marker at `markerOffset` (an index into the body), so
   * the close we matched belongs to a different opener.
   */
  | { reason: 'foreign-markers'; markerOffset: number }
  /** The body is not a viable JSON prefix (first char or bracket depth). */
  | { reason: 'not-viable-json' }

function literalTextReason(
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  body: string
): LiteralTextVerdict | null {
  const isJsonBodied = JSON_BODY_TAG_NAMES.has(tagName)
  // Markers inside a JSON string are content, not evidence — a `<question>` may
  // legitimately quote tag syntax in its prompt. Scanning the raw body here
  // would classify a broken payload as literal text and render it as raw JSON,
  // which is exactly what `discard` exists to prevent. Mirrors the same blanking
  // in unclosedTagCannotResolve, which judges the same body mid-stream.
  const scannable = isJsonBodied ? blankJsonStringLiterals(body) : body
  const marker = TAG_SHAPED_MARKER.exec(scannable)
  if (marker) return { reason: 'foreign-markers', markerOffset: marker.index }
  if (isJsonBodied && !isViableJsonPrefixOf(scannable)) return { reason: 'not-viable-json' }
  return null
}

/** One memoized `indexOf` result, with the `from` it was computed at. */
interface IndexOfCacheEntry {
  /** Result of `content.indexOf(needle, from)`, or -1 when absent from that point on. */
  idx: number
  /** The offset the search started at. The entry says nothing about content before it. */
  from: number
}

export type IndexOfCache = Map<string, IndexOfCacheEntry>

/**
 * `content.indexOf(needle, from)` memoized per needle.
 *
 * The opener scan and the close lookup search the same handful of markers over
 * and over as the cursor advances. A needle absent from the message resolves to
 * -1 once and is never searched again; a present one is re-searched only when
 * the cursor passes its last hit. Unmemoized, each lookup rescans to the end of
 * the buffer for every opener, which is quadratic on a message that mentions a
 * tag name many times — and this parse re-runs for every streamed chunk.
 *
 * A cached result is only valid from the offset it was searched at, so the entry
 * carries that offset and is reused only when the new `from` is at or beyond it:
 *
 * - `idx === -1` means no hit at or after `entry.from`, so there is none at or
 *   after any later `from` either.
 * - `idx >= from` means the first hit at or after `entry.from` is still ahead of
 *   `from`, so nothing lies between them and it is still the first hit.
 *
 * Storing `from` is what makes this correct for ANY call order rather than only
 * for a monotonically advancing cursor. The cursor is monotonic today — every
 * non-pending outcome resumes strictly past its opener — but that is a property
 * of {@link resolveTagAt}'s resume points, and one of them deliberately resumes
 * back inside a span it already examined. A future adjustment that let the cursor
 * regress would, without this check, return a stale index and silently mis-parse
 * rather than fail loudly. With it, the worst case is a redundant scan.
 */
export function memoizedIndexOf(
  cache: IndexOfCache,
  content: string,
  needle: string,
  from: number
): number {
  const entry = cache.get(needle)
  if (entry && from >= entry.from && (entry.idx === -1 || entry.idx >= from)) return entry.idx
  const idx = content.indexOf(needle, from)
  cache.set(needle, { idx, from })
  return idx
}

/**
 * How much of a body may be inspected, and whether that is all of it.
 *
 * The read budget, isolated from what the body turns out to BE. Both the
 * unclosed and matched-pair paths spend it through this one function, so they
 * cannot drift out of agreement about how much of a body may be read.
 */
interface InspectedBody {
  /** The prefix actually examined. */
  text: string
  /** True when `text` is only a prefix, so no verdict drawn from it covers the rest. */
  truncated: boolean
}

function inspectWithin(source: string, start = 0): InspectedBody {
  const end = start + MAX_UNCLOSED_BODY_SCAN
  return end < source.length
    ? { text: source.slice(start, end), truncated: true }
    : { text: start === 0 ? source : source.slice(start), truncated: false }
}

/**
 * What a matched body turned out to BE — independent of what the parser does
 * about it, and of where it resumes.
 *
 * A closed set, and that is the whole point: {@link resolveMatchedPair} and
 * {@link resumeForClass} each switch over it exhaustively, so adding a case
 * fails to compile until BOTH questions are answered for it. Every regression
 * review found on this parser was one of those two answers changing without the
 * other, which is a mistake this shape makes unrepresentable.
 */
type BodyClass =
  /** Parsed, and matched its shape guard. */
  | { kind: 'payload'; segment: ContentSegment }
  /** A tag marker at `offsetInBody` proves the close we matched belongs elsewhere. */
  | { kind: 'nested-marker'; offsetInBody: number }
  /**
   * The same proof, in a PROSE body. Separate because it resumes differently: a
   * prose body is never blanked, so nothing is hidden from the scan and rescanning
   * from the opener is safe, and these bodies are small enough that the extra pass
   * is free. Resuming at the marker instead would also be correct and would emit
   * one text segment rather than two — display-identical, since the renderer
   * concatenates them — but it is a behaviour change and does not belong in a
   * refactor.
   */
  | { kind: 'prose-nested-marker' }
  /** Only a prefix was read, and it settled nothing. Says nothing about the rest. */
  | { kind: 'unexamined' }
  /**
   * Never an attempted payload — prose, prose-in-braces, a bare scalar, an
   * unquoted-key slip. The model's own words: showing them is mandatory,
   * dropping them deletes text the reader was meant to see.
   */
  | { kind: 'not-a-payload' }
  /**
   * An attempted payload that will not parse — opens like JSON (see
   * {@link wasAttemptedPayload}) but carries a syntax error. Droppable: the
   * reader was never meant to see the JSON, and rendering it raw is the
   * failure this parser exists to prevent.
   */
  | { kind: 'not-parsable' }
  /** Parsed as JSON, then failed its shape guard. Droppable, like `not-parsable`. */
  | { kind: 'wrong-shape' }

/**
 * Whether a body that will not parse was nonetheless an ATTEMPT at this tag's
 * JSON payload — the line between `not-parsable` (droppable) and
 * `not-a-payload` (must render).
 *
 * Two pieces of evidence, both required, both structural: the opener pair and
 * a key-value colon. Every payload these tags carry is built from objects of
 * quoted keys, so an attempt opens `{"`, `[{`, or `["` AND carries a `:`
 * outside its string literals. Prose fails one or the other by construction —
 * `{the Q4 report}` opens `{t`, `{type: "file"}` opens `{t`, `{'type':'file'}`
 * opens `{'`, a bare scalar opens with its own first character, and a
 * brace-wrapped quoted phrase (`{"the Q4 report"}`) has no colon outside its
 * quotes — so every wrapped-prose shape stays rendered while a payload one
 * typo away from valid (`{"type":"multi_select",options": …`) is recognized as
 * the broken emission it is. Deleting text is the harm here, so the predicate
 * fails toward rendering. Named for the question it answers, not the checks it performs:
 * the class names assert meaning, and this predicate is what earns the
 * assertion. Blanks on the rare path only, like {@link isParseableJson} — the
 * common cases never reach it.
 */
function wasAttemptedPayload(body: string): boolean {
  const opener = /^\s*([{[])\s*(["{])/.exec(body)
  if (!opener) return false
  if (opener[1] === '{' && opener[2] !== '"') return false
  return blankJsonStringLiterals(body).includes(':')
}

/**
 * Classify a complete body. Pure: no positions, no outcome, no resume.
 *
 * Order is behavioural, not stylistic. The prose-nesting rule precedes the parse
 * because a prose body has no shape to fail — any non-empty text qualifies — so a
 * late close would otherwise swallow whatever the streaming path already showed.
 * The budget precedes the remaining rules so an unread remainder is never
 * mistaken for evidence.
 */
function classifyBody(tagName: (typeof SPECIAL_TAG_NAMES)[number], body: string): BodyClass {
  const isJsonBodied = JSON_BODY_TAG_NAMES.has(tagName)

  if (!isJsonBodied) {
    // The same predicate the streaming path uses, so the two cannot disagree
    // about whether this body was ever a tag. Tag NAMES, not anything
    // tag-shaped: reasoning that mentions `<div>` or `Promise<void>` is still
    // reasoning, and releasing it as prose would put the model's thinking on
    // screen for an incidental angle bracket.
    if (hasSpecialTagMarker(body)) return { kind: 'prose-nested-marker' }
  }

  const parsed = parseSpecialTagData(tagName, body)
  if (parsed) return { kind: 'payload', segment: parsed }

  const inspected = inspectWithin(body)
  const verdict = literalTextReason(tagName, inspected.text)

  if (verdict?.reason === 'foreign-markers') {
    return { kind: 'nested-marker', offsetInBody: verdict.markerOffset }
  }
  if (inspected.truncated) return { kind: 'unexamined' }

  // Dropping text is only defensible for a payload the agent actually
  // ATTEMPTED. A parse settles the well-formed case (`wrong-shape`); for a body
  // that will not parse, the opener decides via wasAttemptedPayload below.
  // Bracket depth can tell neither prose-in-braces nor a typo'd payload from a
  // real one, so both routes to "unparseable" are funnelled through one place
  // and the rescan below cannot be added to one and forgotten on the other.
  const unparseable =
    verdict?.reason === 'not-viable-json' || (isJsonBodied && !isParseableJson(body))

  if (unparseable) {
    // literalTextReason blanked this body's quoted regions on the assumption it
    // was valid JSON. It is not — but the blanked offsets only LIE when the
    // body's quotes are mispaired: an odd `"` blanks the wrong regions, which
    // can hide a real marker and misread a mispaired span as this tag's own
    // body. The difference is not academic: both failure classes below resume
    // past the close, flattening or discarding a genuine tag inside the span,
    // so a card already on screen un-renders when the close finally arrives.
    // With mispaired quotes the raw text is the honest evidence, and a marker
    // in it means the close we matched belongs elsewhere. With BALANCED quotes
    // the blanked scan above already saw every marker outside a string, so a
    // marker visible only in the raw text is quoted content — rescanning would
    // classify a broken payload whose strings legitimately mention tag syntax
    // as nested markers and render it as raw JSON, the exact failure `discard`
    // exists to prevent. Only after the marker question settles may the opener
    // test decide the remaining two classes.
    if (endsInsideJsonString(inspected.text)) {
      const rawMarker = TAG_SHAPED_MARKER.exec(inspected.text)
      if (rawMarker) return { kind: 'nested-marker', offsetInBody: rawMarker.index }
    }
    return wasAttemptedPayload(body) ? { kind: 'not-parsable' } : { kind: 'not-a-payload' }
  }

  return { kind: 'wrong-shape' }
}

/**
 * Where scanning continues, given what the body was. The third concern, kept
 * apart from the other two so a change to one cannot silently alter another.
 *
 * Every branch is strictly greater than the opener, which is what guarantees the
 * cursor advances and {@link memoizedIndexOf}'s cache stays coherent.
 */
function resumeForClass(cls: BodyClass, bodyStart: number, pastClose: number): number {
  switch (cls.kind) {
    case 'payload':
    case 'wrong-shape':
    case 'not-parsable':
    case 'not-a-payload':
      // The whole span was read and accounted for; continue after it.
      return pastClose
    case 'nested-marker':
      // Resume AT the marker, not past the borrowed close and not at the opener.
      // Past the close would skip a genuine tag after it; the opener would rescan
      // a region the blanked scan could not see into, re-parsing tag syntax
      // quoted inside a JSON string and dropping it.
      return bodyStart + cls.offsetInBody
    case 'prose-nested-marker':
      // Rescan the whole body: nothing was blanked, so no marker is hidden.
      return bodyStart
    case 'unexamined':
      // Resume just short of the first character NOT read: the last marker's
      // worth of the window is held back rather than emitted as text, so it is
      // re-scanned on the next pass instead of being flattened. Nothing is lost
      // — the caller emits up to wherever this resumes. It still advances nearly
      // a full window per step, so a long body costs a bounded number of
      // re-entries.
      //
      // The rewind is load-bearing: the window edge is an arbitrary cut, so an
      // opener can straddle it. Resuming exactly at the edge leaves that opener's
      // `<` behind the cursor, and the opener scan only looks FORWARD — so the tag
      // is never found and renders as raw payload text, on a completed message.
      // Backing off by the longest marker guarantees any straddling opener is
      // re-scanned from its `<`.
      return bodyStart + MAX_UNCLOSED_BODY_SCAN - (LONGEST_TAG_MARKER - 1)
  }
}

function resolveMatchedPair(
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  body: string,
  bodyStart: number,
  pastClose: number
): TagResolution {
  const cls = classifyBody(tagName, body)
  const resumeAt = resumeForClass(cls, bodyStart, pastClose)

  switch (cls.kind) {
    case 'payload':
      return { outcome: 'segment', segment: cls.segment, resumeAt }
    case 'wrong-shape':
    case 'not-parsable':
      // Showing the reader raw JSON is worse than showing nothing.
      return { outcome: 'discard', resumeAt }
    case 'nested-marker':
    case 'prose-nested-marker':
    case 'unexamined':
    case 'not-a-payload':
      return { outcome: 'literal', resumeAt }
  }
}

function resolveTagAt(
  content: string,
  openIndex: number,
  tagName: (typeof SPECIAL_TAG_NAMES)[number],
  isStreaming: boolean,
  closeCache: IndexOfCache
): TagResolution {
  const openTag = `<${tagName}>`
  const closeTag = `</${tagName}>`
  const bodyStart = openIndex + openTag.length
  const closeIdx = memoizedIndexOf(closeCache, content, closeTag, bodyStart)

  if (closeIdx === -1) {
    const inspected = inspectWithin(content, bodyStart)
    if (isStreaming) {
      if (!unclosedTagCannotResolve(tagName, inspected.text)) return { outcome: 'pending' }
      // The body can no longer resolve, but it reads as a payload the model is
      // still fumbling: it opens like an attempted payload and everything past
      // its top-level value is JSON debris (a stray `}` or `]}`) — exactly the
      // shapes the matched-pair path DISCARDS the moment a close arrives.
      // Releasing such a body now paints raw JSON on screen only for the close
      // to retract it, so keep suppressing while the stream runs; the settled
      // parse still shows it if the close never comes. Two kinds of
      // counter-evidence release immediately, because each means the model
      // moved on and holding the remainder back would blank the rest of the
      // message for the whole stream — the failure unclosedTagCannotResolve
      // exists to prevent: a tag-shaped marker outside the payload's strings
      // (a misspelled close, a new tag), or prose after the value closed (a
      // mention flowing on, pinned by the trace 220cc02d and trace afbeefd0
      // tests).
      if (JSON_BODY_TAG_NAMES.has(tagName)) {
        const pending = dropArrivingClose(inspected.text, closeTag)
        const blanked = blankJsonStringLiterals(pending)
        if (
          wasAttemptedPayload(pending) &&
          !TAG_SHAPED_MARKER.test(blanked) &&
          JSON_DEBRIS_ONLY.test(blanked.slice(Math.max(0, jsonValueEndIn(blanked))))
        ) {
          return { outcome: 'pending' }
        }
      }
    }
    // Nothing can close it, so only the opener itself is literal. Resuming just
    // past it (rather than abandoning the message) keeps a genuinely valid tag
    // later in the same reply parseable.
    return { outcome: 'literal', resumeAt: bodyStart }
  }

  return resolveMatchedPair(
    tagName,
    content.slice(bodyStart, closeIdx),
    bodyStart,
    closeIdx + closeTag.length
  )
}

/**
 * Splits streamed text into renderable segments, extracting complete special
 * tags and deciding what to do with the ones that never resolve. Incomplete
 * tags are suppressed and flagged via `hasPendingTag` so the caller can show a
 * loading indicator, and a trailing partial opening marker (`<opt`, `<usage_`)
 * is stripped during streaming so it never flashes as raw markup.
 */
export function parseSpecialTags(content: string, isStreaming: boolean): ParsedSpecialContent {
  const segments: ContentSegment[] = []
  let hasPendingTag = false
  let cursor = 0

  // Whitespace-only spans are kept, not trimmed away: the literal path emits a
  // rejected span in several pieces, and a `\n\n` between two of them is a
  // markdown paragraph break. Dropping it silently merges two paragraphs, because
  // the renderer concatenates adjacent text segments into one markdown string.
  const pushText = (text: string) => {
    if (text) segments.push({ type: 'text', content: text })
  }

  const openerCache: IndexOfCache = new Map()
  const closeCache: IndexOfCache = new Map()
  let discardedTag = false

  while (cursor < content.length) {
    let nearestStart = -1
    let nearestTagName: (typeof SPECIAL_TAG_NAMES)[number] | '' = ''

    for (const name of SPECIAL_TAG_NAMES) {
      const idx = memoizedIndexOf(openerCache, content, `<${name}>`, cursor)
      if (idx !== -1 && (nearestStart === -1 || idx < nearestStart)) {
        nearestStart = idx
        nearestTagName = name
      }
    }

    // Only the name is tested: the two are assigned together above, so an empty
    // name and a -1 start are the same state — and the name is the one that
    // needs narrowing before resolveTagAt below.
    if (nearestTagName === '') {
      let remaining = content.slice(cursor)

      if (isStreaming) {
        // Hide a half-arrived opening marker so it does not flash as text.
        const partial = remaining.match(/<[a-z_-]*$/i)
        if (partial) {
          const fragment = partial[0].slice(1)
          if (
            fragment.length > 0 &&
            [...SPECIAL_TAG_NAMES, ...RUNTIME_SPECIAL_TAG_NAMES].some((t) => t.startsWith(fragment))
          ) {
            remaining = remaining.slice(0, -partial[0].length)
            hasPendingTag = true
          }
        }
      }

      pushText(remaining)
      break
    }

    pushText(content.slice(cursor, nearestStart))

    const resolution = resolveTagAt(content, nearestStart, nearestTagName, isStreaming, closeCache)

    if (resolution.outcome === 'pending') {
      hasPendingTag = true
      break
    }

    if (resolution.outcome === 'segment') {
      segments.push(resolution.segment)
    } else if (resolution.outcome === 'literal') {
      pushText(content.slice(nearestStart, resolution.resumeAt))
    } else {
      // `discard` deliberately emits nothing. Remembering that it happened is
      // what keeps the fallback below from undoing it.
      discardedTag = true
    }

    cursor = resolution.resumeAt
  }

  // A message with no segments is normally a message with nothing in it, and
  // emitting the raw content is the right floor. But a discard produces no
  // segment BY DESIGN, so without this guard a message that is only a broken
  // payload falls through and renders the exact raw JSON the discard removed.
  if (segments.length === 0 && !hasPendingTag && !discardedTag) {
    segments.push({ type: 'text', content })
  }

  if (!isStreaming) {
    recoverTrailingBareOptions(segments)
    recoverTrailingBareQuestion(segments)
  }

  return { segments, hasPendingTag }
}
/**
 * Recovers a trailing bare-JSON options payload the model emitted WITHOUT the
 * `<options>` wrapper (observed when an automation prompt asks the model to
 * "(re)send suggested actions" and it answers with the JSON as content). The
 * shape check is strict — a non-empty object whose every value is
 * { title, description } with numeric-string keys — so ordinary JSON in prose
 * cannot false-positive. Only a message's FINAL text segment is considered,
 * mirroring the tag contract (options go last), and only when no options tag
 * already parsed. Never applied mid-stream: a partial JSON tail must not
 * flicker between prose and a card.
 */
const NEAR_MISS_OPTIONS_WRAPPER = /<option>\s*(\{[\s\S]*\})\s*<\/option>\s*$/

/**
 * Locates a trailing bare JSON payload: the earliest opening delimiter from
 * which the whole remainder parses. Nested objects mean the FIRST `{` is not
 * necessarily the payload's start, so positions are probed left to right and
 * bounded so a brace-heavy prose block cannot become a hot loop.
 */
function findTrailingJsonPayload(
  text: string,
  openers: string[]
): { start: number; body: string } | null {
  const trimmed = text.trimEnd()
  if (!openers.some((opener) => trimmed.endsWith(opener === '[' ? ']' : '}'))) return null
  let probe = -1
  for (const opener of openers) {
    const index = text.indexOf(opener)
    if (index !== -1 && (probe === -1 || index < probe)) probe = index
  }
  for (let attempts = 0; probe !== -1 && attempts < 20; attempts++) {
    const body = text.slice(probe).trim()
    try {
      JSON.parse(body)
      return { start: probe, body }
    } catch {
      let next = -1
      for (const opener of openers) {
        const index = text.indexOf(opener, probe + 1)
        if (index !== -1 && (next === -1 || index < next)) next = index
      }
      probe = next
    }
  }
  return null
}

/** Drops a bare `question` / `<question>` label sitting just before a payload. */
const BARE_QUESTION_LABEL = /(^|\n)\s*<?questions?>?\s*:?\s*$/i

/**
 * Recovers a trailing `<question>` payload the model emitted WITHOUT the
 * wrapper, mirroring {@link recoverTrailingBareOptions}.
 *
 * Safe to attempt on bare JSON because the question shape is far more
 * distinctive than the options one: `parseQuestionTagBody` requires a `type` of
 * exactly `single_select` or `multi_select`, a non-empty `prompt`, and a
 * non-empty `options` array of `{id, label}`. Ordinary JSON in prose — a config
 * blob, an API response, a code sample — does not carry that combination, so
 * the strict validator is the whole gate. Accepts an array or a single object,
 * exactly as the tagged path does.
 */
function recoverTrailingBareQuestion(segments: ContentSegment[]): void {
  const last = segments[segments.length - 1]
  if (!last || last.type !== 'text') return
  if (segments.some((segment) => segment.type === 'question')) return
  const payload = findTrailingJsonPayload(last.content, ['{', '['])
  if (!payload) return
  const data = parseQuestionTagBody(payload.body)
  if (!data) return
  const prefix = last.content
    .slice(0, payload.start)
    .replace(/\s+$/, '')
    .replace(BARE_QUESTION_LABEL, '$1')
    .replace(/\s+$/, '')
  segments.pop()
  if (prefix) segments.push({ type: 'text', content: prefix })
  segments.push({ type: 'question', data })
}

function recoverTrailingBareOptions(segments: ContentSegment[]): void {
  const last = segments[segments.length - 1]
  if (!last || last.type !== 'text') return
  if (segments.some((segment) => segment.type === 'options')) return
  let text = last.content
  // A near-miss wrapper — the singular `<option>` tag observed in the wild —
  // is neither a parseable tag nor bare JSON (the trailing `</option>` fails
  // the brace gate below). Unwrap it and let the strict shape check decide.
  const nearMiss = NEAR_MISS_OPTIONS_WRAPPER.exec(text)
  if (nearMiss) {
    text = `${text.slice(0, nearMiss.index)}${nearMiss[1]}`
  }
  if (!text.trimEnd().endsWith('}')) return
  // The payload nests objects, so the START brace is the first one from which
  // the remainder parses — probe brace positions left to right (bounded).
  let start = -1
  let parsed: unknown
  let probe = text.indexOf('{')
  for (let attempts = 0; probe !== -1 && attempts < 20; attempts++) {
    try {
      parsed = JSON.parse(text.slice(probe).trim())
      start = probe
      break
    } catch {
      probe = text.indexOf('{', probe + 1)
    }
  }
  if (start === -1) return
  const repaired = repairFlattenedOptionEntry(parsed)
  if (!isOptionsTagData(repaired) || Object.keys(repaired as object).length === 0) return
  // The contract numbers options from 1 upward. Demanding the exact run — not
  // merely "every key is numeric" — keeps a numeric-keyed map that happens to
  // hold {title, description} values (e.g. {"0": {…}}) from becoming a card.
  if (!isSequentialOptionKeys(Object.keys(repaired as object))) return
  // A bare `options` / `<options>` label immediately before the payload is the
  // wrapper the model meant to emit, not prose — drop it rather than leaving a
  // stray word above the card.
  const prefix = text
    .slice(0, start)
    .replace(/\s+$/, '')
    .replace(/(^|\n)\s*<?options>?\s*:?\s*$/i, '$1')
    .replace(/\s+$/, '')
  segments.pop()
  if (prefix) segments.push({ type: 'text', content: prefix })
  segments.push({ type: 'options', data: repaired })
}

interface SpecialTagsProps {
  segment: Exclude<ContentSegment, { type: 'text' }>
  requestMode?: 'agent' | 'assistant'
  /** Stable identity for interaction state owned by this message/tag. */
  interactionId?: string
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  /** Transcript-derived status payload for this message's credential card. */
  credentialSubmission?: CredentialSubmissionPayload
  /** The user moved on without submitting this message's credential card. */
  credentialAbandoned?: boolean
  onOptionSelect?: (id: string) => void
  onQuestionDismiss?: () => void
  onWorkspaceResourceSelect?: (resource: WorkspaceResourceRef) => void
}

/**
 * Unified renderer for inline special tags: `<options>`, `<usage_upgrade>`, `<credential>`,
 * and `<workspace_resource>`. A `<source>` never reaches here — the chat renderer
 * folds it into the surrounding markdown as an inline chip.
 */
export function SpecialTags({
  segment,
  requestMode,
  interactionId,
  questionAnswers,
  credentialSubmission,
  credentialAbandoned,
  onOptionSelect,
  onQuestionDismiss,
  onWorkspaceResourceSelect,
}: SpecialTagsProps) {
  switch (segment.type) {
    case 'thinking':
      return null
    case 'options':
      return <OptionsDisplay data={segment.data} onSelect={onOptionSelect} />
    case 'usage_upgrade':
      return <UsageUpgradeDisplay data={segment.data} />
    case 'credential':
      return (
        <CredentialDisplay
          data={segment.data}
          requestMode={requestMode}
          interactionId={interactionId}
          submitted={credentialSubmission}
          abandoned={credentialAbandoned}
          onContinue={onOptionSelect}
        />
      )
    case 'mothership-error':
      return <MothershipErrorDisplay data={segment.data} />
    case 'workspace_resource':
      return <WorkspaceResourceDisplay data={segment.data} onSelect={onWorkspaceResourceSelect} />
    case 'source':
      return null
    case 'question':
      return (
        <QuestionDisplay
          data={segment.data}
          answers={questionAnswers}
          onSelect={onOptionSelect}
          onDismiss={onQuestionDismiss}
        />
      )
    default:
      return null
  }
}

interface OptionsDisplayProps {
  data: OptionsTagData
  onSelect?: (id: string) => void
}

function OptionsDisplay({ data, onSelect }: OptionsDisplayProps) {
  const disabled = !onSelect
  const [collapsedByUser, setCollapsedByUser] = useState(false)
  // When interactive (not disabled), always expanded. When disabled, the user can toggle.
  const expanded = !disabled || !collapsedByUser
  const entries = Object.entries(data)

  if (entries.length === 0) return null

  return (
    <div>
      {disabled ? (
        <button
          type='button'
          onClick={() => setCollapsedByUser((prev) => !prev)}
          aria-expanded={expanded}
          className='flex items-center gap-2'
        >
          <span className='text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
          <ChevronDown
            className={cn(
              'size-[14px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <span className='text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
      )}
      <Expandable expanded={expanded}>
        <ExpandableContent className='mt-1.5'>
          <div className='flex flex-col'>
            {entries.map(([key, value], i) => {
              const title = value.title

              return (
                <button
                  key={key}
                  type='button'
                  disabled={disabled}
                  onClick={() => onSelect?.(title)}
                  className={cn(
                    'flex items-center gap-2 border-[var(--border)] px-2 py-2 text-left transition-colors',
                    disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]',
                    i > 0 && 'border-t'
                  )}
                >
                  <div className='flex size-[16px] shrink-0 items-center justify-center'>
                    <span className='text-[var(--text-icon)] text-sm'>{i + 1}</span>
                  </div>
                  <span className='flex-1 text-[var(--text-body)] text-sm'>{title}</span>
                  <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
                </button>
              )
            })}
          </div>
        </ExpandableContent>
      </Expandable>
    </div>
  )
}

function fallbackWorkspaceResourceTitle(type: WorkspaceResourceTagType): string {
  switch (type) {
    case 'workflow':
      return 'Workflow'
    case 'table':
      return 'Table'
    case 'file':
      return 'File'
  }
}

function toMothershipResourceType(type: WorkspaceResourceTagType): MothershipResource['type'] {
  return type
}

function toChatMessageContext(data: WorkspaceResourceTagData, label: string): ChatMessageContext {
  switch (data.type) {
    case 'workflow':
      return { kind: 'workflow', label, workflowId: data.id ?? '' }
    case 'table':
      return { kind: 'table', label, tableId: data.id ?? '' }
    case 'file':
      return { kind: 'file', label, fileId: data.id ?? data.path ?? '' }
  }
}

export function WorkspaceResourceDisplay({
  data,
  onSelect,
}: {
  data: WorkspaceResourceTagData
  onSelect?: (resource: WorkspaceResourceRef) => void
}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId)

  const resource = useMemo<WorkspaceResourceRef>(() => {
    const fileFromPath =
      data.type === 'file' ? findWorkspaceFileByPath(files, data.path) : undefined
    const title =
      data.type === 'workflow'
        ? (workflows.find((workflow) => workflow.id === data.id)?.name ??
          fallbackWorkspaceResourceTitle(data.type))
        : data.type === 'table'
          ? (tables.find((table) => table.id === data.id)?.name ??
            fallbackWorkspaceResourceTitle(data.type))
          : data.type === 'file'
            ? (files.find((file) => file.id === data.id)?.name ??
              fileFromPath?.name ??
              data.title ??
              fallbackWorkspaceResourceTitle(data.type))
            : (knowledgeBases.find((knowledgeBase) => knowledgeBase.id === data.id)?.name ??
              fallbackWorkspaceResourceTitle(data.type))

    const id = data.id ?? fileFromPath?.id
    return {
      type: toMothershipResourceType(data.type),
      ...(id ? { id } : {}),
      title,
      ...(data.type === 'file' && data.path ? { path: data.path } : {}),
    }
  }, [data.id, data.path, data.title, data.type, files, knowledgeBases, tables, workflows])

  const context = toChatMessageContext(data, resource.title)

  return (
    <ResourceMention
      icon={
        <ContextMentionIcon
          context={context}
          className='relative top-0.5 size-[12px] shrink-0 text-[var(--text-icon)]'
        />
      }
      title={resource.title}
      onSelect={onSelect ? () => onSelect(resource) : undefined}
    />
  )
}

function getCredentialIcon(provider: string): React.ComponentType<{ className?: string }> | null {
  const lower = provider.toLowerCase()
  if (lower === 'gitlab')
    return resolveCredentialDisplay({
      type: 'personal_token',
      providerId: lower,
      displayName: provider,
    }).icon

  const directMatch = OAUTH_PROVIDERS[lower]
  if (directMatch) return directMatch.icon

  for (const config of Object.values(OAUTH_PROVIDERS)) {
    if (config.name.toLowerCase() === lower) return config.icon
    for (const service of Object.values(config.services)) {
      if (service.name.toLowerCase() === lower) return service.icon
      if (service.providerId.toLowerCase() === lower) return service.icon
    }
  }

  return null
}

function getCredentialProviderDisplayName(provider: string): string {
  if (provider.toLowerCase() === 'gitlab')
    return resolveCredentialDisplay({
      type: 'personal_token',
      providerId: 'gitlab',
      displayName: provider,
    }).detailTitle
  return (
    getServiceConfigByProviderId(provider)?.name ??
    OAUTH_PROVIDERS[provider.toLowerCase()]?.name ??
    provider
  )
}

const LockIcon = (props: { className?: string }) => (
  <svg
    className={props.className}
    viewBox='0 0 16 16'
    fill='none'
    xmlns='http://www.w3.org/2000/svg'
  >
    <rect x='2' y='5' width='12' height='8' rx='1.5' stroke='currentColor' strokeWidth='1.3' />
    <path
      d='M5 5V3.5a3 3 0 1 1 6 0V5'
      stroke='currentColor'
      strokeWidth='1.3'
      strokeLinecap='round'
    />
    <circle cx='8' cy='9.5' r='1.25' fill='currentColor' />
  </svg>
)

/**
 * Inline "paste a secret" widget rendered for
 * `<credential>{"type":"secret_input","name":"OPENAI_API_KEY"}</credential>`.
 * Reuses the shared emcn SecretInput; the pasted value is saved straight to
 * workspace (default) or personal environment variables under `name` and never
 * flows back through the chat transcript.
 */
interface CredentialControlProps {
  data: CredentialItemData
  requestMode?: 'agent' | 'assistant'
  controlId?: string
  embedded?: boolean
  divided?: boolean
  secretValue?: string
  onSecretValueChange?: (value: string) => void
  onSaved?: () => void
  onConnected?: () => void
}

/**
 * Attaches the agent-authored descriptions to workspace secrets once their values
 * are saved, reusing the credential update endpoint the secrets settings page
 * calls. It runs after the value write because that write is what mints the
 * credential row a description hangs on, and it is best-effort: the value is the
 * point of the card, so a failed note never fails the save. Personal rows are
 * skipped — their credential rows are per-workspace mirrors of one user-global
 * secret, so no single row can own a description.
 */
function useWorkspaceSecretDescriptions(items: CredentialItemData[]) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const describedByName = useMemo(() => {
    const entries = new Map<string, string>()
    for (const item of items) {
      if (item.type !== 'secret_input' || item.scope === 'personal') continue
      const name = item.name?.trim()
      const description = item.description?.trim()
      if (name && description) entries.set(name, description)
    }
    return entries
  }, [items])

  const credentialsQuery = useWorkspaceCredentials({
    workspaceId,
    type: 'env_workspace',
    enabled: describedByName.size > 0,
  })
  const updateCredential = useUpdateWorkspaceCredential()
  const refetchCredentials = credentialsQuery.refetch

  return useCallback(
    async (savedNames: string[]) => {
      const pending = savedNames.filter((name) => describedByName.has(name))
      if (pending.length === 0) return

      try {
        const { data } = await refetchCredentials()
        const idByEnvKey = new Map((data ?? []).map((row) => [row.envKey, row.id]))
        await Promise.all(
          pending.map(async (name) => {
            const credentialId = idByEnvKey.get(name)
            if (!credentialId) return
            await updateCredential.mutateAsync({
              credentialId,
              description: describedByName.get(name),
            })
          })
        )
      } catch {
        // Swallowed deliberately: the secret is stored, and the card must not
        // report failure over a missing note.
      }
    },
    [describedByName, refetchCredentials, updateCredential.mutateAsync]
  )
}

function SecretInputDisplay({ data, divided = false, onSaved }: CredentialControlProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const secretName = (data.name ?? '').trim()
  const scope: SecretInputScope = data.scope === 'personal' ? 'personal' : 'workspace'

  const [value, setValue] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const [saved, setSaved] = useState(false)

  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const personalQuery = usePersonalEnvironment()
  const personalEnv = personalQuery.data
  const { canEdit } = useUserPermissionsContext()
  const attachDescriptions = useWorkspaceSecretDescriptions(useMemo(() => [data], [data]))

  // Setting a workspace var needs write/admin (same gate as the secrets manager);
  // personal vars are the user's own, so any member may set them.
  const canManage = scope === 'personal' || canEdit

  const isSaving = upsertWorkspace.isPending || savePersonal.isPending
  // Personal saves replace the whole map, so block until existing vars are loaded.
  const personalReady = scope !== 'personal' || personalEnv !== undefined
  const canSave =
    canManage && secretName.length > 0 && value.trim().length > 0 && !isSaving && personalReady

  const handleSave = async () => {
    if (!canSave) return
    try {
      if (scope === 'personal') {
        // The personal POST replaces the whole map, so re-read the latest vars
        // right before merging — a stale snapshot would drop keys saved elsewhere.
        const { data: latest } = await personalQuery.refetch()
        const merged: Record<string, string> = {}
        for (const [key, entry] of Object.entries(latest ?? personalEnv ?? {}))
          merged[key] = entry.value
        merged[secretName] = value
        await savePersonal.mutateAsync({ variables: merged })
      } else {
        await upsertWorkspace.mutateAsync({ workspaceId, variables: { [secretName]: value } })
        await attachDescriptions([secretName])
      }
      setValue('')
      setSaved(true)
      onSaved?.()
      toast.success(`Saved ${secretName}`)
    } catch {
      toast.error(`Couldn't save ${secretName}. Please try again.`)
    }
  }

  if (!secretName) return null
  // Only confirm after the user saves via THIS widget. A fresh prompt always shows
  // the input so the user can set or override the key, even if it already exists.
  if (saved) return <SecretReveal redacted />
  if (!canManage) return null

  return (
    <InteractionCardInputRow
      divided={divided}
      type='text'
      value={isFocused ? value : '•'.repeat(value.length)}
      placeholder={`Paste ${secretName}`}
      autoComplete='off'
      aria-label={secretName}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onChange={(event) => {
        if (isFocused) setValue(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.currentTarget.blur()
          return
        }
        if (event.key === 'Enter' && canSave) {
          event.preventDefault()
          void handleSave()
        }
      }}
      trailing={
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <button
              type='button'
              onClick={() => void handleSave()}
              disabled={!canSave}
              aria-label='Save'
              className='disabled:cursor-default'
            >
              <ArrowRight
                className={cn(
                  'size-[16px] shrink-0 transition-colors',
                  canSave ? 'text-[var(--text-body)]' : 'text-[var(--text-icon)]'
                )}
              />
            </button>
          </Tooltip.Trigger>
          <Tooltip.Content>{isSaving ? 'Saving…' : 'Save'}</Tooltip.Content>
        </Tooltip.Root>
      }
    />
  )
}

interface CredentialSecretInputRowProps {
  name: string
  value: string
  divided?: boolean
  onChange: (value: string) => void
}

/** Secret draft field for the unified card; the card's final Submit owns persistence. */
function CredentialSecretInputRow({
  name,
  value,
  divided = false,
  onChange,
}: CredentialSecretInputRowProps) {
  const [isFocused, setIsFocused] = useState(false)

  return (
    <InteractionCardInputRow
      divided={divided}
      type='text'
      value={isFocused ? value : '•'.repeat(value.length)}
      placeholder={`Paste ${name}`}
      autoComplete='off'
      aria-label={name}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      onChange={(event) => {
        const maskedValue = '•'.repeat(value.length)
        if (isFocused || event.target.value !== maskedValue) onChange(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.currentTarget.blur()
      }}
    />
  )
}

/**
 * Folder icon for the local-folder grant chip (matches the credential chip
 * icon sizing).
 */
const FolderGrantIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path
      d='M1.5 4.5A1.5 1.5 0 0 1 3 3h3.2l1.6 1.8H13A1.5 1.5 0 0 1 14.5 6.3v5.2A1.5 1.5 0 0 1 13 13H3a1.5 1.5 0 0 1-1.5-1.5v-7z'
      stroke='currentColor'
      strokeWidth='1.2'
      strokeLinejoin='round'
    />
  </svg>
)

/**
 * Inline grant chip rendered for
 * `<credential>{"type":"folder_access","name":"Desktop"}</credential>`.
 * Clicking opens the desktop app's native folder picker (read-only grant,
 * same flow as the Desktop settings folder picker). Renders nothing outside the
 * desktop app — there is no local filesystem bridge to grant against.
 */
function FolderAccessDisplay({ data }: { data: CredentialItemData }) {
  const [picking, setPicking] = useState(false)
  const [grantedName, setGrantedName] = useState<string | null>(null)

  const bridge = getDesktopBridge()
  if (!bridge?.localFilesystem) return null

  const hint = (data.name ?? '').trim()
  const label = grantedName
    ? `Access granted — ${grantedName}`
    : hint
      ? `Grant access to ${hint}`
      : 'Grant access to a local folder'

  const handleClick = async () => {
    if (picking || grantedName) return
    setPicking(true)
    try {
      const response = await bridge.localFilesystem({ operation: 'mount_directory' })
      if (response.ok && 'mount' in response.data && response.data.mount) {
        setGrantedName(response.data.mount.name)
        toast.success(`Granted access to ${response.data.mount.name}`)
      }
    } catch {
      toast.error("Couldn't open the folder picker. Please try again.")
    } finally {
      setPicking(false)
    }
  }

  return (
    <button
      type='button'
      onClick={() => void handleClick()}
      disabled={picking || grantedName !== null}
      className={cn(
        'flex w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 text-left transition-colors',
        grantedName === null && !picking && 'hover-hover:bg-[var(--surface-5)]',
        picking && 'opacity-60'
      )}
    >
      <FolderGrantIcon className='size-[16px] shrink-0' />
      <span className='flex-1 text-[var(--text-body)] text-sm'>
        {picking ? 'Choose a folder…' : label}
      </span>
      {grantedName === null && (
        <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      )}
    </button>
  )
}

/**
 * Shared browser hand-back question. While active it reports the selected
 * answer; after completion the same component renders its answered recap.
 */
export function BrowserTakeoverQuestion({
  reason,
  answer,
  onAnswer,
}: {
  reason?: string
  answer?: string
  onAnswer?: (answer: string) => void
}) {
  const normalizedReason = reason?.trim() ?? ''
  const normalizedAnswer = answer?.trim() ?? ''
  const prompt = normalizedReason || 'Finish in the browser'
  const questions: QuestionItem[] = [
    {
      type: 'single_select',
      prompt,
      options: [{ id: 'continue', label: 'Continue' }],
    },
  ]

  return (
    <QuestionDisplay
      data={questions}
      answers={normalizedAnswer ? [normalizedAnswer] : undefined}
      dismissible={false}
      onSelect={
        onAnswer
          ? (message) => {
              const answer = parseQuestionAnswerMessage(questions, message)?.[0]?.trim()
              if (answer) onAnswer(answer)
            }
          : undefined
      }
    />
  )
}

/** Connects the active browser question to the desktop panel action. */
function BrowserTakeoverDisplay({ data }: { data: CredentialItemData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { chatId } = useChatSurface()

  if (!isBrowserAgentAvailable()) return null

  return (
    <BrowserTakeoverQuestion
      reason={data.name}
      onAnswer={(answer) => {
        const takeoverResponse = answer !== 'Continue' ? answer : undefined
        sendBrowserPanelAction(
          'takeover-done',
          takeoverResponse ? { takeoverResponse } : {},
          desktopChatScopeId(workspaceId, chatId)
        )
      }}
    />
  )
}

/**
 * Inline "set up a service account" control rendered for
 * `<credential>{"type":"service_account","provider":"slack"}</credential>`.
 *
 * Opens `ConnectServiceAccountModal` over the chat rather than linking out to
 * the integrations page — the user stays in the conversation that asked for
 * the credential, and comes back to it with the credential in hand.
 */
function ServiceAccountConnectDisplay({
  data,
  embedded = false,
  divided = false,
  onConnected,
}: CredentialControlProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { canEdit } = useUserPermissionsContext()
  const [open, setOpen] = useState(false)
  const [locallyConnected, setLocallyConnected] = useState(false)

  const match = useMemo(
    () => (data.provider ? resolveServiceAccountIntegration(data.provider) : null),
    [data.provider]
  )
  const service = useMemo(() => (match ? resolveOAuthServiceForSlug(match.slug) : null), [match])
  const target = useServiceAccountConnectTarget({
    serviceAccountProviderId: match?.serviceAccountProviderId,
    serviceName: match?.serviceName,
    serviceIcon: service?.serviceIcon,
  })

  // A credentialId reconnects (rotates the secret on) that existing service
  // account in place rather than creating a new one — the modal keeps its id.
  const reconnectCredentialId = data.credentialId
  const { data: reconnectCredential } = useWorkspaceCredential(reconnectCredentialId)
  const connected = locallyConnected

  // Creating a credential mutates the workspace — hide it from read-only
  // members, and honour the provider's own preview gate (custom Slack bots
  // ride the slack_v2 flag) so chat can't surface what the integrations page
  // deliberately hides.
  if (!target || target.hidden || !canEdit || !workspaceId) return null

  const label = reconnectCredentialId
    ? `Reconnect ${reconnectCredential?.displayName ?? target.serviceName}`
    : `${target.label} for ${target.serviceName}`
  const displayLabel = connected ? `Connected ${target.serviceName}` : label

  return (
    <>
      <button
        type='button'
        onClick={() => {
          if (!connected) setOpen(true)
        }}
        disabled={connected}
        className={cn(
          embedded
            ? INTERACTION_CARD_ROW_CLASSES
            : 'flex w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 text-left transition-colors',
          embedded && divided && 'border-t',
          'hover-hover:bg-[var(--surface-5)]'
        )}
      >
        <BrandIcon icon={target.serviceIcon} className='size-[16px] shrink-0' />
        <span className='flex-1 text-[var(--text-body)] text-sm'>{displayLabel}</span>
        {connected ? (
          <Check className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        ) : (
          <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        )}
      </button>
      {open && (
        <Suspense fallback={null}>
          <ConnectServiceAccountModal
            open={open}
            onOpenChange={setOpen}
            workspaceId={workspaceId}
            serviceAccountProviderId={target.serviceAccountProviderId}
            atlassianProduct={match?.providerId === 'confluence' ? 'confluence' : 'jira'}
            serviceName={target.serviceName}
            serviceIcon={target.serviceIcon}
            credentialId={reconnectCredentialId}
            credentialDisplayName={reconnectCredential?.displayName ?? undefined}
            onCreated={() => {
              setLocallyConnected(true)
              onConnected?.()
            }}
          />
        </Suspense>
      )}
    </>
  )
}

function CredentialLinkDisplay({
  data,
  controlId = 'credential-link',
  embedded = false,
  divided = false,
  onConnected,
}: CredentialControlProps) {
  const { canEdit } = useUserPermissionsContext()
  const integrationName = getCredentialProviderDisplayName(data.provider ?? '')
  const {
    reconnectCredentialId,
    status,
    connected,
    connectedFromAttempt,
    hasExistingCredential,
    isReady,
    onConnectClick,
  } = useOAuthChipConnection({
    connectUrl: data.value,
    provider: data.provider,
    displayName: integrationName,
    controlId,
    onConnected,
  })
  const { data: reconnectCredential } = useWorkspaceCredential(reconnectCredentialId)

  // Connecting a credential mutates the workspace — hide it from read-only members.
  if (!data.provider || !canEdit) return null
  // The connect link value comes from the streamed model output, so only
  // render it as a clickable link when it resolves to a real http(s) URL.
  if (!data.value || !isSafeHttpUrl(data.value)) return null
  const Icon = getCredentialIcon(data.provider) ?? LockIcon
  const label = reconnectCredentialId
    ? `Reconnect ${reconnectCredential?.displayName ?? integrationName}`
    : hasExistingCredential
      ? `Connect another ${integrationName}`
      : `Connect ${integrationName}`
  const retryLabel = reconnectCredentialId
    ? `Not connected — reconnect ${reconnectCredential?.displayName ?? integrationName}`
    : hasExistingCredential
      ? `Not connected — connect another ${integrationName}`
      : `Not connected — connect ${integrationName}`
  const displayLabel = connected
    ? `Connected ${integrationName}`
    : !isReady
      ? `Checking ${integrationName} connections…`
      : status === 'pending'
        ? `Waiting for ${integrationName} connection…`
        : status === 'failed'
          ? retryLabel
          : label

  return (
    <a
      href={data.value}
      target='_blank'
      rel='noopener noreferrer'
      onClick={onConnectClick}
      aria-disabled={!isReady || connectedFromAttempt}
      className={cn(
        embedded
          ? INTERACTION_CARD_ROW_CLASSES
          : 'flex items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 transition-colors',
        embedded && divided && 'border-t',
        'hover-hover:bg-[var(--surface-5)]'
      )}
    >
      <BrandIcon icon={Icon} className='size-[16px] shrink-0' />
      <span className='flex-1 text-[var(--text-body)] text-sm'>{displayLabel}</span>
      {connected ? (
        <Check className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      ) : (
        <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      )}
    </a>
  )
}

function PersonalCredentialLinkDisplay({
  data,
  controlId = 'credential-link',
  embedded = false,
  divided = false,
  onConnected,
}: CredentialControlProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { canEdit } = useUserPermissionsContext()
  const [tokenModalOpen, setTokenModalOpen] = useState(false)
  const provider = data.provider?.trim() ?? ''
  const name = getCredentialProviderDisplayName(provider)
  const connection = usePersonalCredentialConnection({
    provider,
    displayName: name,
    controlId,
    onConnected,
  })
  if (!provider || (provider.toLowerCase() === 'gitlab' && !canEdit)) return null
  const Icon = getCredentialIcon(provider) ?? LockIcon
  const connected = connection.status === 'connected'
  const label = connected
    ? `Connected ${name}`
    : connection.hasMetadataError
      ? `Retry checking ${name} connections`
      : !connection.isReady
        ? `Checking ${name} connections…`
        : connection.status === 'pending'
          ? `Waiting for ${name} connection…`
          : connection.status === 'failed'
            ? `Not connected — connect ${name}`
            : `Connect ${name}`
  return (
    <>
      <button
        type='button'
        disabled={
          (!connection.isReady && !connection.hasMetadataError) ||
          connected ||
          connection.isStarting
        }
        onClick={() => {
          if (connection.hasMetadataError) {
            void connection.retryMetadata()
            return
          }
          if (provider.toLowerCase() === 'gitlab') {
            connection.beginPersonalToken()
            setTokenModalOpen(true)
          } else connection.connectOAuth()
        }}
        className={cn(
          embedded
            ? INTERACTION_CARD_ROW_CLASSES
            : 'flex w-full items-center gap-2 rounded-2xl border border-[var(--border)] px-3 py-2.5 text-left transition-colors',
          embedded && divided && 'border-t',
          'hover-hover:bg-[var(--surface-5)]'
        )}
      >
        <BrandIcon icon={Icon} className='size-[16px] shrink-0' />
        <span className='flex-1 text-[var(--text-body)] text-sm'>{label}</span>
        {connected ? (
          <Check className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        ) : (
          <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
        )}
      </button>
      {connection.error && (
        <p role='alert' className='px-3 py-2 text-[var(--text-error)] text-caption'>
          {connection.error}
        </p>
      )}
      {tokenModalOpen && (
        <Suspense fallback={null}>
          <ConnectPersonalTokenModal
            open={tokenModalOpen}
            onOpenChange={(open) => {
              setTokenModalOpen(open)
              if (!open) connection.cancelPersonalToken()
            }}
            workspaceId={workspaceId}
            onConnected={connection.connectedPersonalToken}
          />
        </Suspense>
      )}
    </>
  )
}

/**
 * Inline hand-back chip rendered while a terminal handoff waits on the user —
 * a command sitting on a prompt only they can answer. Without it the tool row
 * just spins: the command is blocked in a panel the user may not even be
 * looking at, with nothing saying it wants them. Clicking tells the waiting
 * handoff they are done; the terminal id rides in `value` so the click reaches
 * the right shell. Renders nothing outside the desktop app.
 */
function TerminalHandoffDisplay({ data }: { data: CredentialItemData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { chatId } = useChatSurface()
  const [handedBack, setHandedBack] = useState(false)

  if (!isTerminalAvailable()) return null

  const reason = (data.name ?? '').trim()
  const label = handedBack
    ? 'Handed control back to Sim'
    : reason || 'Finish in the terminal, then hand control back'

  return (
    <button
      type='button'
      onClick={() => {
        if (handedBack) return
        setHandedBack(true)
        finishTerminalHandoff(data.value ?? '', desktopChatScopeId(workspaceId, chatId))
      }}
      disabled={handedBack}
      className={cn(
        'flex w-full items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 text-left transition-colors',
        !handedBack && 'hover-hover:bg-[var(--surface-5)]'
      )}
    >
      <TerminalWindow className='size-[16px] shrink-0' />
      <span className='flex-1 text-[var(--text-body)] text-sm'>{label}</span>
      {!handedBack && <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />}
    </button>
  )
}

/**
 * sim_key stays in the routing set so a payload carrying one still takes the
 * card path (CredentialDisplay renders its reveal separately), but it is an
 * output, so the card itself never shows it as a row.
 */
const CREDENTIAL_CARD_TYPES: ReadonlySet<CredentialTagType> = new Set([
  'secret_input',
  'link',
  'service_account',
  'sim_key',
])

function isCredentialCardItemVisible(
  item: CredentialItemData,
  canEdit: boolean,
  requestMode?: 'agent' | 'assistant'
): boolean {
  if (requestMode === 'assistant')
    return (
      item.type === 'link' &&
      Boolean(item.provider?.trim()) &&
      (item.provider?.trim().toLowerCase() !== 'gitlab' || canEdit)
    )
  if (item.type === 'sim_key') return false
  if (item.type === 'secret_input') return item.scope === 'personal' || canEdit
  if (item.type === 'link') {
    return canEdit && Boolean(item.provider) && Boolean(item.value && isSafeHttpUrl(item.value))
  }
  return canEdit
}

/** Whether a terminal credential tag produces the shared question-style card. */
export function credentialTagHasVisibleCard(
  data: CredentialTagData,
  canEdit: boolean,
  requestMode?: 'agent' | 'assistant'
): boolean {
  return (
    data.length > 0 &&
    data.every((item) => CREDENTIAL_CARD_TYPES.has(item.type)) &&
    data.some((item) => isCredentialCardItemVisible(item, canEdit, requestMode))
  )
}

function CredentialItemDisplay({
  data,
  requestMode,
  controlId,
  embedded = false,
  divided = false,
  secretValue,
  onSecretValueChange,
  onSaved,
  onConnected,
}: CredentialControlProps) {
  if (
    requestMode === 'assistant' &&
    data.type !== 'link' &&
    data.type !== 'browser_takeover' &&
    data.type !== 'terminal_handoff'
  )
    return null
  if (data.type === 'secret_input') {
    const secretName = data.name?.trim()
    if (embedded) {
      if (!secretName || !onSecretValueChange) return null
      return (
        <CredentialSecretInputRow
          name={secretName}
          value={secretValue ?? ''}
          divided={divided}
          onChange={onSecretValueChange}
        />
      )
    }
    return (
      <SecretInputDisplay data={data} embedded={embedded} divided={divided} onSaved={onSaved} />
    )
  }

  if (data.type === 'folder_access') {
    return <FolderAccessDisplay data={data} />
  }

  if (data.type === 'browser_takeover') {
    return <BrowserTakeoverDisplay data={data} />
  }

  if (data.type === 'terminal_handoff') {
    return <TerminalHandoffDisplay data={data} />
  }

  if (data.type === 'link') {
    if (requestMode === 'assistant') {
      return (
        <PersonalCredentialLinkDisplay
          data={data}
          controlId={controlId}
          embedded={embedded}
          divided={divided}
          onConnected={onConnected}
        />
      )
    }
    return (
      <CredentialLinkDisplay
        data={data}
        controlId={controlId}
        embedded={embedded}
        divided={divided}
        onConnected={onConnected}
      />
    )
  }

  if (data.type === 'service_account') {
    return (
      <ServiceAccountConnectDisplay
        data={data}
        embedded={embedded}
        divided={divided}
        onConnected={onConnected}
      />
    )
  }

  // sim_key never reaches here: CredentialDisplay renders its reveal chip
  // standalone (SecretReveal masks itself when the tag carries no value).
  return null
}

/**
 * Credential input and OAuth controls use the same InteractionCard primitives
 * as QuestionDisplay. Integrations come first and secrets follow in one card
 * with one Submit; legacy/system actions retain their standalone presentation.
 */
function CredentialInputCard({
  data,
  requestMode,
  interactionId,
  submitted,
  abandoned,
  onContinue,
}: {
  data: CredentialTagData
  requestMode?: 'agent' | 'assistant'
  interactionId?: string
  submitted?: CredentialSubmissionPayload
  abandoned?: boolean
  onContinue?: (message: string) => void
}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { canEdit } = useUserPermissionsContext()
  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const personalQuery = usePersonalEnvironment({ enabled: requestMode !== 'assistant' })
  const attachDescriptions = useWorkspaceSecretDescriptions(requestMode === 'assistant' ? [] : data)
  const [secretDrafts, setSecretDrafts] = useState<Record<number, string>>({})
  const [savedSecretRows, setSavedSecretRows] = useState<Set<number>>(() => new Set())
  const [connectedIntegrationRows, setConnectedIntegrationRows] = useState<Set<number>>(
    () => new Set()
  )
  const [locallySubmitted, setLocallySubmitted] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const controlIdPrefix = interactionId ?? 'credential-card'

  /**
   * An abandoned card recaps from progress its rows made, but it replaces those
   * rows — so on a fresh mount nothing is left to report a connect the user
   * already finished, and the recap would read "Skipped" over it. An OAuth
   * connect records a row-scoped attempt that outlives the mount, so restore
   * the verdict from there.
   *
   * Only OAuth rows need this. A secret is written solely by Submit, which ends
   * the card as a real submission instead; a service-account connect never
   * outlives its own row either way.
   */
  useEffect(() => {
    if (!abandoned) return
    const restored = new Set<number>()
    let restoreIndex = 0
    for (const [dataIndex, item] of data.entries()) {
      if (item.type !== 'link' && item.type !== 'service_account') continue
      const index = restoreIndex++
      if (item.type !== 'link') continue
      const { providerId, reconnectCredentialId } =
        requestMode === 'assistant'
          ? {
              providerId:
                resolveOAuthServiceForSlug(item.provider ?? '')?.providerId ?? item.provider ?? '',
              reconnectCredentialId: undefined,
            }
          : resolveOAuthChipTarget(item.value, item.provider)
      if (!providerId) continue
      const attempt = readLatestOAuthChatAttempt({
        workspaceId,
        providerId,
        controlId: `${requestMode === 'assistant' ? 'personal:' : ''}${controlIdPrefix}:${dataIndex}`,
        credentialId: reconnectCredentialId,
      })
      if (attempt?.status === 'connected') restored.add(index)
    }
    if (restored.size === 0) return
    setConnectedIntegrationRows((current) => {
      if (Array.from(restored).every((index) => current.has(index))) return current
      return new Set([...current, ...restored])
    })
  }, [abandoned, controlIdPrefix, data, workspaceId, requestMode])

  let integrationIndex = 0
  let secretIndex = 0
  const indexedRows = data.map((item, dataIndex) => ({
    item,
    dataIndex,
    integrationIndex:
      item.type === 'link' || item.type === 'service_account' ? integrationIndex++ : undefined,
    secretIndex: item.type === 'secret_input' ? secretIndex++ : undefined,
  }))
  const visibleRows = indexedRows.filter(({ item }) =>
    isCredentialCardItemVisible(item, canEdit, requestMode)
  )
  if (visibleRows.length === 0) return null

  const integrationRows = visibleRows.filter(
    ({ item }) => item.type === 'link' || item.type === 'service_account'
  )
  const secretRows = visibleRows.filter(({ item }) => item.type === 'secret_input')
  const title =
    integrationRows.length > 0 && secretRows.length > 0
      ? 'Set up credentials'
      : integrationRows.length > 0
        ? 'Connect integrations'
        : 'Add secrets'
  const rows = [
    ...integrationRows.map(({ item, dataIndex, integrationIndex }, index) => (
      <CredentialItemDisplay
        key={`${item.type}-${item.provider ?? dataIndex}-${dataIndex}`}
        data={item}
        requestMode={requestMode}
        controlId={`${controlIdPrefix}:${dataIndex}`}
        embedded
        divided={index > 0}
        onConnected={() =>
          setConnectedIntegrationRows((current) => {
            if (integrationIndex === undefined || current.has(integrationIndex)) return current
            const next = new Set(current)
            next.add(integrationIndex)
            return next
          })
        }
      />
    )),
    ...secretRows.map(({ item, dataIndex, secretIndex }, index) => {
      return (
        <CredentialItemDisplay
          key={`${item.type}-${item.name ?? dataIndex}-${dataIndex}`}
          data={item}
          embedded
          divided={integrationRows.length > 0 || index > 0}
          secretValue={
            item.type === 'secret_input' ? (secretDrafts[secretIndex ?? -1] ?? '') : undefined
          }
          onSecretValueChange={
            item.type === 'secret_input' && secretIndex !== undefined
              ? (value) =>
                  setSecretDrafts((current) => ({
                    ...current,
                    [secretIndex]: value,
                  }))
              : undefined
          }
        />
      )
    }),
  ]

  const submitCredentialSetup = async (): Promise<boolean> => {
    if (!onContinue) return false

    const workspaceVariables: Record<string, string> = {}
    const personalVariables: Record<string, string> = {}
    const enteredSecretIndexes: number[] = []

    for (const { item, secretIndex } of secretRows) {
      if (secretIndex === undefined) continue
      const name = item.name?.trim()
      const value = secretDrafts[secretIndex] ?? ''
      if (!name || value.trim().length === 0) continue
      const target = item.scope === 'personal' ? personalVariables : workspaceVariables
      target[name] = value
      enteredSecretIndexes.push(secretIndex)
    }

    try {
      const saves: Promise<unknown>[] = []
      if (Object.keys(workspaceVariables).length > 0) {
        saves.push(upsertWorkspace.mutateAsync({ workspaceId, variables: workspaceVariables }))
      }
      if (Object.keys(personalVariables).length > 0) {
        saves.push(
          (async () => {
            const { data: latest } = await personalQuery.refetch()
            const merged: Record<string, string> = {}
            for (const [key, entry] of Object.entries(latest ?? personalQuery.data ?? {})) {
              merged[key] = entry.value
            }
            Object.assign(merged, personalVariables)
            await savePersonal.mutateAsync({ variables: merged })
          })()
        )
      }
      await Promise.all(saves)
    } catch {
      toast.error(`Couldn't save secrets. Please try again.`)
      return false
    }

    await attachDescriptions(Object.keys(workspaceVariables))

    const nextSavedSecretRows = new Set(savedSecretRows)
    for (const index of enteredSecretIndexes) nextSavedSecretRows.add(index)
    setSavedSecretRows(nextSavedSecretRows)

    onContinue(
      formatCredentialSubmissionMessage(data, {
        connectedIntegrationIndexes: connectedIntegrationRows,
        savedSecretIndexes: nextSavedSecretRows,
      })
    )
    return true
  }

  const needsContinuation = integrationRows.length > 0 || secretRows.length > 0
  const credentialSummary = [
    ...integrationRows.map(({ item, integrationIndex }) => ({
      label: getCredentialProviderDisplayName(item.provider ?? 'Integration'),
      status: (
        submitted
          ? submitted.integrations[integrationIndex ?? -1]?.status === 'connected'
          : connectedIntegrationRows.has(integrationIndex ?? -1)
      )
        ? ('Connected' as const)
        : ('Skipped' as const),
    })),
    ...secretRows.map(({ item, secretIndex }) => {
      const saved = submitted
        ? submitted.secrets[secretIndex ?? -1]?.status === 'saved'
        : savedSecretRows.has(secretIndex ?? -1)
      return {
        label: item.name ?? 'Secret',
        status: saved ? ('Added' as const) : ('Skipped' as const),
      }
    }),
  ]

  // An abandoned card recaps from local progress only: a row the user connected
  // or saved before moving on keeps its status, everything else reads "Skipped".
  if (submitted || locallySubmitted || (abandoned && needsContinuation)) {
    return (
      <InteractionCardRecap
        items={credentialSummary.map((item) => ({ label: item.label, values: [item.status] }))}
      />
    )
  }

  const handleSubmit = async () => {
    if (isSubmitting) return
    setIsSubmitting(true)
    try {
      if (await submitCredentialSetup()) setLocallySubmitted(true)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <InteractionCard title={title}>
      <div className='flex flex-col'>
        {rows}
        {needsContinuation && onContinue && (
          <InteractionCardActionRow
            label='Submit'
            disabled={isSubmitting}
            onClick={() => void handleSubmit()}
          />
        )}
      </div>
    </InteractionCard>
  )
}

export function CredentialDisplay({
  data,
  requestMode,
  interactionId,
  submitted,
  abandoned,
  onContinue,
}: {
  data: CredentialTagData
  requestMode?: 'agent' | 'assistant'
  interactionId?: string
  submitted?: CredentialSubmissionPayload
  abandoned?: boolean
  onContinue?: (message: string) => void
}) {
  // A sim_key is an OUTPUT — the workspace API key the platform filled in —
  // never a setup request, so it renders as its own reveal chip outside any
  // card. Inside the question-style card it read as something to submit, and
  // the card's recap swallowed the key after Submit. The reveal also outlives
  // submission/abandonment: the key must stay retrievable. The full payload
  // still flows to the card so row indexes (OAuth controlIds, submission
  // pairing) stay stable — the card simply renders no sim_key rows.
  const simKeyReveals = data
    .map((item, index) =>
      item.type === 'sim_key' && requestMode !== 'assistant' ? (
        <SecretReveal key={`sim-key-${index}`} value={item.value} />
      ) : null
    )
    .filter(Boolean)
  const inputItems = data.filter((item) => item.type !== 'sim_key')
  const usesCredentialCard = data.every((item) => CREDENTIAL_CARD_TYPES.has(item.type))

  const inputControls = usesCredentialCard ? (
    <CredentialInputCard
      data={data}
      requestMode={requestMode}
      interactionId={interactionId}
      submitted={submitted}
      abandoned={abandoned}
      onContinue={onContinue}
    />
  ) : inputItems.length > 0 ? (
    <div className={cn(inputItems.length > 1 && 'space-y-3')}>
      {inputItems.map((item, index) => (
        <CredentialItemDisplay
          key={`${item.type}-${item.provider ?? item.name ?? index}`}
          data={item}
          requestMode={requestMode}
        />
      ))}
    </div>
  ) : null

  if (simKeyReveals.length === 0) return inputControls
  return (
    <div className='space-y-3'>
      {simKeyReveals}
      {inputControls}
    </div>
  )
}

/**
 * The message is the whole user-facing story. The raw `code` is an internal
 * identifier ("async_resume_aborted") that means nothing to a reader and made
 * every error line end in parenthesized jargon; it stays in the tag payload for
 * logs and support, just not on screen.
 */
function MothershipErrorDisplay({ data }: { data: MothershipErrorTagData }) {
  return (
    <p className='text-[13px] text-[var(--text-secondary)] italic leading-[20px]'>{data.message}</p>
  )
}

function UsageUpgradeDisplay({ data }: { data: UsageUpgradeTagData }) {
  const { data: session } = useSession()
  const hostContext = useWorkspaceHostContext()
  const { getSettingsHref } = useSettingsNavigation()
  const { hosted } = useDeploymentShape()
  const buttonLabel = data.action === 'upgrade_plan' ? 'Upgrade Plan' : 'Increase Limit'

  // Self-hosted plan and limit both live on the hosted account, so local
  // workspace billing roles say nothing about who may change them.
  const href = hosted
    ? getSettingsHref({ section: 'billing' })
    : data.action === 'upgrade_plan'
      ? buildHostedUpgradeUrl()
      : HOSTED_BILLING_SETTINGS_URL
  const canManageBilling = !hosted || canManageWorkspaceBilling(hostContext, session?.user?.id)
  const unavailableMessage = hostContext.hostOrganizationId
    ? 'Contact an organization admin to manage this workspace’s usage limits.'
    : 'Only the workspace owner can manage this workspace’s usage limits.'

  return (
    <div className='rounded-2xl border border-amber-300/40 bg-amber-50/50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-950/20'>
      <div className='flex items-center gap-2'>
        <svg
          className='size-4 shrink-0 text-amber-600 dark:text-amber-400'
          viewBox='0 0 16 16'
          fill='none'
          xmlns='http://www.w3.org/2000/svg'
        >
          <path
            d='M8 1.5L1 14h14L8 1.5z'
            stroke='currentColor'
            strokeWidth='1.3'
            strokeLinejoin='round'
          />
          <path d='M8 6.5v3' stroke='currentColor' strokeWidth='1.3' strokeLinecap='round' />
          <circle cx='8' cy='11.5' r='0.75' fill='currentColor' />
        </svg>
        <span className='text-amber-800 text-sm leading-5 dark:text-amber-300'>
          Usage Limit Reached
        </span>
      </div>
      <p className='mt-1.5 text-amber-700/90 text-small leading-[20px] dark:text-amber-400/80'>
        {data.message}
      </p>
      {canManageBilling ? (
        <a
          href={href}
          target={hosted ? undefined : '_blank'}
          rel={hosted ? undefined : 'noopener noreferrer'}
          aria-label={hosted ? undefined : `${buttonLabel} (opens in a new tab)`}
          className='mt-2 inline-flex items-center gap-1 text-amber-700 text-small underline decoration-dashed underline-offset-2 transition-colors hover-hover:text-amber-900 dark:text-amber-300 dark:hover-hover:text-amber-200'
        >
          {buttonLabel}
          {hosted ? <ArrowRight className='size-3' /> : <SquareArrowUpRight className='size-3' />}
        </a>
      ) : (
        <p className='mt-2 text-amber-700 text-small dark:text-amber-300'>{unavailableMessage}</p>
      )}
    </div>
  )
}
