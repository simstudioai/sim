'use client'

import { createElement, useMemo, useState } from 'react'
import {
  ArrowRight,
  Button,
  ChevronDown,
  cn,
  Expandable,
  ExpandableContent,
  SecretInput,
  SecretReveal,
  Tooltip,
  toast,
} from '@sim/emcn'
import { useParams } from 'next/navigation'
import { canonicalWorkspaceFilePath } from '@/lib/copilot/vfs/path-utils'
import { isSafeHttpUrl } from '@/lib/core/utils/urls'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import { QuestionDisplay } from '@/app/workspace/[workspaceId]/home/components/message-content/components/question'
import type {
  ChatMessageContext,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  usePersonalEnvironment,
  useSavePersonalEnvironment,
  useUpsertWorkspaceEnvironment,
} from '@/hooks/queries/environment'
import { useKnowledgeBasesQuery } from '@/hooks/queries/kb/knowledge'
import { useTablesList } from '@/hooks/queries/tables'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useWorkspaceFiles } from '@/hooks/queries/workspace-files'

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

export const CREDENTIAL_TAG_TYPES = [
  'env_key',
  'oauth_key',
  'sim_key',
  'credential_id',
  'link',
  'secret_input',
] as const

export type CredentialTagType = (typeof CREDENTIAL_TAG_TYPES)[number]

export const SECRET_INPUT_SCOPES = ['personal', 'workspace'] as const

export type SecretInputScope = (typeof SECRET_INPUT_SCOPES)[number]

export interface CredentialTagData {
  value?: string
  type: CredentialTagType
  provider?: string
  redacted?: boolean
  /**
   * Env-var key name to save the pasted secret under (secret_input only),
   * e.g. "OPENAI_API_KEY".
   */
  name?: string
  /** Where a secret_input value is persisted. Defaults to "workspace". */
  scope?: SecretInputScope
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
 * One question in a `<question>` tag. Both types require at least one option;
 * the card always appends its own free-text "Something else" row, so
 * agent-supplied catch-all options ("Other", "Something else", ...) are
 * stripped during parsing.
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

export type ContentSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'options'; data: OptionsTagData }
  | { type: 'usage_upgrade'; data: UsageUpgradeTagData }
  | { type: 'credential'; data: CredentialTagData }
  | { type: 'mothership-error'; data: MothershipErrorTagData }
  | { type: 'workspace_resource'; data: WorkspaceResourceTagData }
  | { type: 'question'; data: QuestionTagData }

export type RuntimeSpecialTagName =
  | 'thinking'
  | 'options'
  | 'credential'
  | 'mothership-error'
  | 'file'
  | 'workspace_resource'
  | 'question'

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
] as const

const SPECIAL_TAG_NAMES = [
  'thinking',
  'options',
  'usage_upgrade',
  'credential',
  'mothership-error',
  'workspace_resource',
  'question',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isOptionsItemData(value: unknown): value is OptionsItemData {
  if (!isRecord(value)) return false
  return typeof value.title === 'string' && typeof value.description === 'string'
}

function isOptionsTagData(value: unknown): value is OptionsTagData {
  if (!isRecord(value)) return false
  return Object.values(value).every(isOptionsItemData)
}

function isUsageUpgradeTagData(value: unknown): value is UsageUpgradeTagData {
  if (!isRecord(value)) return false
  return (
    typeof value.reason === 'string' &&
    typeof value.message === 'string' &&
    typeof value.action === 'string' &&
    (USAGE_UPGRADE_ACTIONS as readonly string[]).includes(value.action)
  )
}

function isCredentialTagData(value: unknown): value is CredentialTagData {
  if (!isRecord(value)) return false
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
  if (value.redacted === true) return value.value === undefined || typeof value.value === 'string'
  return typeof value.value === 'string'
}

function isMothershipErrorTagData(value: unknown): value is MothershipErrorTagData {
  if (!isRecord(value)) return false
  return (
    typeof value.message === 'string' &&
    (value.code === undefined || typeof value.code === 'string') &&
    (value.provider === undefined || typeof value.provider === 'string')
  )
}

function isWorkspaceResourceTagData(value: unknown): value is WorkspaceResourceTagData {
  if (!isRecord(value)) return false
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
  if (!isRecord(value)) return false
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
  if (!isRecord(value)) return false
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
  isExpectedShape: (value: unknown) => value is T
): T | null {
  try {
    const parsed = JSON.parse(body) as unknown
    return isExpectedShape(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function parseTextTagBody(body: string): string | null {
  return body.trim() ? body : null
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
  | { type: 'thinking'; content: string }
  | { type: 'options'; data: OptionsTagData }
  | { type: 'usage_upgrade'; data: UsageUpgradeTagData }
  | { type: 'credential'; data: CredentialTagData }
  | { type: 'mothership-error'; data: MothershipErrorTagData }
  | { type: 'workspace_resource'; data: WorkspaceResourceTagData }
  | { type: 'question'; data: QuestionTagData }
  | null {
  if (tagName === 'thinking') {
    const content = parseTextTagBody(body)
    return content ? { type: 'thinking', content } : null
  }

  if (tagName === 'options') {
    const data = parseJsonTagBody(body, isOptionsTagData)
    return data ? { type: 'options', data } : null
  }

  if (tagName === 'usage_upgrade') {
    const data = parseJsonTagBody(body, isUsageUpgradeTagData)
    return data ? { type: 'usage_upgrade', data } : null
  }

  if (tagName === 'credential') {
    const data = parseJsonTagBody(body, isCredentialTagData)
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

  if (tagName === 'question') {
    const data = parseQuestionTagBody(body)
    return data ? { type: 'question', data } : null
  }

  return null
}

/**
 * Parses inline special tags (`<options>`, `<usage_upgrade>`, `<workspace_resource>`) from streamed
 * text content. Complete tags are extracted into typed segments; incomplete
 * tags (still streaming) are suppressed from display and flagged via
 * `hasPendingTag` so the caller can show a loading indicator.
 *
 * Trailing partial opening tags (e.g. `<opt`, `<usage_`) are also stripped
 * during streaming to prevent flashing raw markup.
 */
export function parseSpecialTags(content: string, isStreaming: boolean): ParsedSpecialContent {
  const segments: ContentSegment[] = []
  let hasPendingTag = false
  let cursor = 0

  while (cursor < content.length) {
    let nearestStart = -1
    let nearestTagName: (typeof SPECIAL_TAG_NAMES)[number] | '' = ''

    for (const name of SPECIAL_TAG_NAMES) {
      const idx = content.indexOf(`<${name}>`, cursor)
      if (idx !== -1 && (nearestStart === -1 || idx < nearestStart)) {
        nearestStart = idx
        nearestTagName = name
      }
    }

    if (nearestStart === -1) {
      let remaining = content.slice(cursor)

      if (isStreaming) {
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

      if (remaining.trim()) {
        segments.push({ type: 'text', content: remaining })
      }
      break
    }

    if (nearestStart > cursor) {
      const text = content.slice(cursor, nearestStart)
      if (text.trim()) {
        segments.push({ type: 'text', content: text })
      }
    }

    const openTag = `<${nearestTagName}>`
    const closeTag = `</${nearestTagName}>`
    const bodyStart = nearestStart + openTag.length
    const closeIdx = content.indexOf(closeTag, bodyStart)

    if (closeIdx === -1) {
      hasPendingTag = true
      cursor = content.length
      break
    }

    const body = content.slice(bodyStart, closeIdx)
    if (!nearestTagName) {
      cursor = closeIdx + closeTag.length
      continue
    }
    const parsedTag = parseSpecialTagData(nearestTagName, body)
    if (parsedTag) {
      segments.push(parsedTag)
    }

    cursor = closeIdx + closeTag.length
  }

  if (segments.length === 0 && !hasPendingTag) {
    segments.push({ type: 'text', content })
  }

  return { segments, hasPendingTag }
}

const THINKING_BLOCKS = [
  { color: '#2ABBF8', delay: '0s' },
  { color: '#00F701', delay: '0.2s' },
  { color: '#FA4EDF', delay: '0.6s' },
  { color: '#FFCC02', delay: '0.4s' },
] as const

interface SpecialTagsProps {
  segment: Exclude<ContentSegment, { type: 'text' }>
  /** Transcript-derived answers for this message's question card (renders the recap). */
  questionAnswers?: string[]
  onOptionSelect?: (id: string) => void
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
}

/**
 * Unified renderer for inline special tags: `<options>`, `<usage_upgrade>`, `<credential>`,
 * and `<workspace_resource>`.
 */
export function SpecialTags({
  segment,
  questionAnswers,
  onOptionSelect,
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
      return <CredentialDisplay data={segment.data} />
    case 'mothership-error':
      return <MothershipErrorDisplay data={segment.data} />
    case 'workspace_resource':
      return <WorkspaceResourceDisplay data={segment.data} onSelect={onWorkspaceResourceSelect} />
    case 'question':
      return (
        <QuestionDisplay data={segment.data} answers={questionAnswers} onSelect={onOptionSelect} />
      )
    default:
      return null
  }
}

/**
 * Renders a "Thinking" shimmer while a special tag is still streaming in.
 */
export function PendingTagIndicator() {
  return (
    <div className='flex animate-stream-fade-in items-center gap-2 py-2'>
      <div className='grid size-[16px] grid-cols-2 gap-[1.5px]'>
        {THINKING_BLOCKS.map((block, i) => (
          <div
            key={i}
            className='animate-thinking-block rounded-xs'
            style={{ backgroundColor: block.color, animationDelay: block.delay }}
          />
        ))}
      </div>
      <span className='text-[var(--text-body)] text-sm'>Thinking…</span>
    </div>
  )
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
              'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
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
                    'flex items-center gap-2 border-[var(--divider)] px-2 py-2 text-left transition-colors',
                    disabled ? 'cursor-not-allowed' : 'hover-hover:bg-[var(--surface-5)]',
                    i > 0 && 'border-t'
                  )}
                >
                  <div className='flex size-[16px] flex-shrink-0 items-center justify-center'>
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
  onSelect?: (resource: MothershipResource) => void
}) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const { data: workflows = [] } = useWorkflows(workspaceId)
  const { data: tables = [] } = useTablesList(workspaceId)
  const { data: files = [] } = useWorkspaceFiles(workspaceId)
  const { data: knowledgeBases = [] } = useKnowledgeBasesQuery(workspaceId)

  const resource = useMemo<MothershipResource>(() => {
    const fileFromPath =
      data.type === 'file' && data.path
        ? files.find(
            (file) =>
              canonicalWorkspaceFilePath({ folderPath: file.folderPath, name: file.name }) ===
              data.path
          )
        : undefined
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

    return {
      type: toMothershipResourceType(data.type),
      id: data.id ?? fileFromPath?.id ?? data.path ?? '',
      title,
      ...(data.type === 'file' && data.path ? { path: data.path } : {}),
    }
  }, [data.id, data.path, data.title, data.type, files, knowledgeBases, tables, workflows])

  const context = toChatMessageContext(data, resource.title)

  const mentionContent = (
    <>
      <ContextMentionIcon
        context={context}
        className='relative top-0.5 size-[12px] flex-shrink-0 text-[var(--text-icon)]'
      />
      {resource.title}
    </>
  )

  const classes =
    'inline-flex items-baseline gap-1 rounded-[5px] bg-[var(--surface-5)] px-[5px] align-baseline font-[inherit] text-[inherit] leading-[inherit]'

  if (!onSelect) {
    return <span className={classes}>{mentionContent}</span>
  }

  return (
    <button
      type='button'
      onClick={() => onSelect(resource)}
      className={cn(classes, 'cursor-pointer transition-colors hover-hover:bg-[var(--surface-6)]')}
    >
      {mentionContent}
    </button>
  )
}

function getCredentialIcon(provider: string): React.ComponentType<{ className?: string }> | null {
  const lower = provider.toLowerCase()

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
function SecretInputDisplay({ data }: { data: CredentialTagData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const secretName = (data.name ?? '').trim()
  const scope: SecretInputScope = data.scope === 'personal' ? 'personal' : 'workspace'

  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)

  const upsertWorkspace = useUpsertWorkspaceEnvironment()
  const savePersonal = useSavePersonalEnvironment()
  const personalQuery = usePersonalEnvironment()
  const personalEnv = personalQuery.data
  const { canEdit } = useUserPermissionsContext()

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
      }
      setValue('')
      setSaved(true)
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
    <SecretInput
      value={value}
      onChange={setValue}
      placeholder={`Paste ${secretName}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          void handleSave()
        }
      }}
      endAdornment={
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              type='button'
              variant='quiet'
              className='size-[18px] rounded-sm p-0'
              onClick={() => void handleSave()}
              disabled={!canSave}
              aria-label='Save'
            >
              <ArrowRight className='size-[13px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>{isSaving ? 'Saving…' : 'Save'}</Tooltip.Content>
        </Tooltip.Root>
      }
    />
  )
}

function CredentialDisplay({ data }: { data: CredentialTagData }) {
  const { canEdit } = useUserPermissionsContext()

  if (data.type === 'secret_input') {
    return <SecretInputDisplay data={data} />
  }

  if (data.type === 'link') {
    // Connecting a credential mutates the workspace — hide it from read-only members.
    if (!data.provider || !canEdit) return null
    // The connect link value comes from the streamed model output, so only
    // render it as a clickable link when it resolves to a real http(s) URL.
    if (!data.value || !isSafeHttpUrl(data.value)) return null
    const Icon = getCredentialIcon(data.provider) ?? LockIcon
    return (
      <a
        href={data.value}
        target='_blank'
        rel='noopener noreferrer'
        className='flex items-center gap-2 rounded-2xl border border-[var(--border-1)] px-3 py-2.5 transition-colors hover-hover:bg-[var(--surface-5)]'
      >
        {createElement(Icon, { className: 'size-[16px] shrink-0' })}
        <span className='flex-1 text-[var(--text-body)] text-sm'>Connect {data.provider}</span>
        <ArrowRight className='size-[16px] shrink-0 text-[var(--text-icon)]' />
      </a>
    )
  }

  if (data.type === 'sim_key') {
    return <SecretReveal value={data.value} redacted={data.redacted || !data.value} />
  }

  return null
}

function MothershipErrorDisplay({ data }: { data: MothershipErrorTagData }) {
  const detail = data.code ? `${data.message} (${data.code})` : data.message

  return <p className='text-[13px] text-[var(--text-secondary)] italic leading-[20px]'>{detail}</p>
}

function UsageUpgradeDisplay({ data }: { data: UsageUpgradeTagData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const settingsPath = `/workspace/${workspaceId}/settings/billing`
  const buttonLabel = data.action === 'upgrade_plan' ? 'Upgrade Plan' : 'Increase Limit'

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
        <span className='font-[500] text-amber-800 text-sm leading-5 dark:text-amber-300'>
          Usage Limit Reached
        </span>
      </div>
      <p className='mt-1.5 text-amber-700/90 text-small leading-[20px] dark:text-amber-400/80'>
        {data.message}
      </p>
      <a
        href={settingsPath}
        className='mt-2 inline-flex items-center gap-1 font-[500] text-amber-700 text-small underline decoration-dashed underline-offset-2 transition-colors hover-hover:text-amber-900 dark:text-amber-300 dark:hover-hover:text-amber-200'
      >
        {buttonLabel}
        <ArrowRight className='size-3' />
      </a>
    </div>
  )
}
