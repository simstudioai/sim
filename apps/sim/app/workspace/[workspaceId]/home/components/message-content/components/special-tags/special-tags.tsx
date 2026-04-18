'use client'

import { createElement, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { ArrowRight, ChevronDown, Expandable, ExpandableContent } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { ContextMentionIcon } from '@/app/workspace/[workspaceId]/home/components/context-mention-icon'
import type {
  ChatMessageContext,
  MothershipResource,
} from '@/app/workspace/[workspaceId]/home/types'
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
] as const

export type CredentialTagType = (typeof CREDENTIAL_TAG_TYPES)[number]

export interface CredentialTagData {
  value: string
  type: CredentialTagType
  provider?: string
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

export const WORKSPACE_RESOURCE_TAG_TYPES = ['workflow', 'table', 'file'] as const

export type WorkspaceResourceTagType = (typeof WORKSPACE_RESOURCE_TAG_TYPES)[number]

export interface WorkspaceResourceTagData {
  type: WorkspaceResourceTagType
  id: string
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

export type RuntimeSpecialTagName =
  | 'thinking'
  | 'options'
  | 'credential'
  | 'mothership-error'
  | 'file'
  | 'workspace_resource'

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
] as const

const SPECIAL_TAG_NAMES = [
  'thinking',
  'options',
  'usage_upgrade',
  'credential',
  'mothership-error',
  'workspace_resource',
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
  return (
    typeof value.value === 'string' &&
    typeof value.type === 'string' &&
    (CREDENTIAL_TAG_TYPES as readonly string[]).includes(value.type) &&
    (value.provider === undefined || typeof value.provider === 'string')
  )
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
  return (
    typeof value.type === 'string' &&
    (WORKSPACE_RESOURCE_TAG_TYPES as readonly string[]).includes(value.type) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0
  )
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
  onOptionSelect?: (id: string) => void
  onWorkspaceResourceSelect?: (resource: MothershipResource) => void
}

/**
 * Unified renderer for inline special tags: `<options>`, `<usage_upgrade>`, `<credential>`,
 * and `<workspace_resource>`.
 */
export function SpecialTags({
  segment,
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
      <div className='grid h-[16px] w-[16px] grid-cols-2 gap-[1.5px]'>
        {THINKING_BLOCKS.map((block, i) => (
          <div
            key={i}
            className='animate-thinking-block rounded-xs'
            style={{ backgroundColor: block.color, animationDelay: block.delay }}
          />
        ))}
      </div>
      <span className='font-base text-[var(--text-body)] text-sm'>Thinking…</span>
    </div>
  )
}

interface OptionsDisplayProps {
  data: OptionsTagData
  onSelect?: (id: string) => void
}

function OptionsDisplay({ data, onSelect }: OptionsDisplayProps) {
  const disabled = !onSelect
  const [expanded, setExpanded] = useState(!disabled)
  const entries = Object.entries(data)

  useEffect(() => {
    if (!disabled) {
      setExpanded(true)
    }
  }, [disabled])

  if (entries.length === 0) return null

  return (
    <div>
      {disabled ? (
        <button
          type='button'
          onClick={() => setExpanded((prev) => !prev)}
          aria-expanded={expanded}
          className='flex items-center gap-2'
        >
          <span className='font-base text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
          <ChevronDown
            className={cn(
              'h-[7px] w-[9px] text-[var(--text-icon)] transition-transform duration-150',
              !expanded && '-rotate-90'
            )}
          />
        </button>
      ) : (
        <span className='font-base text-[var(--text-body)] text-sm'>Suggested follow-ups</span>
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
                  <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                    <span className='font-base text-[var(--text-icon)] text-sm'>{i + 1}</span>
                  </div>
                  <span className='flex-1 font-base text-[var(--text-body)] text-sm'>{title}</span>
                  <ArrowRight className='h-[16px] w-[16px] shrink-0 text-[var(--text-icon)]' />
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
      return { kind: 'workflow', label, workflowId: data.id }
    case 'table':
      return { kind: 'table', label, tableId: data.id }
    case 'file':
      return { kind: 'file', label, fileId: data.id }
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
    const title =
      data.type === 'workflow'
        ? (workflows.find((workflow) => workflow.id === data.id)?.name ??
          fallbackWorkspaceResourceTitle(data.type))
        : data.type === 'table'
          ? (tables.find((table) => table.id === data.id)?.name ??
            fallbackWorkspaceResourceTitle(data.type))
          : data.type === 'file'
            ? (files.find((file) => file.id === data.id)?.name ??
              fallbackWorkspaceResourceTitle(data.type))
            : (knowledgeBases.find((knowledgeBase) => knowledgeBase.id === data.id)?.name ??
              fallbackWorkspaceResourceTitle(data.type))

    return {
      type: toMothershipResourceType(data.type),
      id: data.id,
      title,
    }
  }, [data.id, data.type, files, knowledgeBases, tables, workflows])

  const context = useMemo(() => toChatMessageContext(data, resource.title), [data, resource.title])

  const workflowColor = useMemo(() => {
    if (data.type !== 'workflow') return null
    return workflows.find((workflow) => workflow.id === data.id)?.color ?? null
  }, [data.id, data.type, workflows])

  const mentionContent = (
    <>
      <ContextMentionIcon
        context={context}
        workflowColor={workflowColor}
        className='relative top-0.5 h-[12px] w-[12px] flex-shrink-0 text-[var(--text-icon)]'
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

function CredentialDisplay({ data }: { data: CredentialTagData }) {
  if (data.type !== 'link' || !data.provider) return null

  const Icon = getCredentialIcon(data.provider) ?? LockIcon

  return (
    <a
      href={data.value}
      target='_blank'
      rel='noopener noreferrer'
      className='flex items-center gap-2 rounded-lg border border-[var(--divider)] px-3 py-2.5 transition-colors hover-hover:bg-[var(--surface-5)]'
    >
      {createElement(Icon, { className: 'h-[16px] w-[16px] shrink-0' })}
      <span className='flex-1 font-base text-[var(--text-body)] text-sm'>
        Connect {data.provider}
      </span>
      <ArrowRight className='h-[16px] w-[16px] shrink-0 text-[var(--text-icon)]' />
    </a>
  )
}

function MothershipErrorDisplay({ data }: { data: MothershipErrorTagData }) {
  const detail = data.code ? `${data.message} (${data.code})` : data.message

  return (
    <p className='font-base text-[13px] text-[var(--text-secondary)] italic leading-[20px]'>
      {detail}
    </p>
  )
}

function UsageUpgradeDisplay({ data }: { data: UsageUpgradeTagData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const settingsPath = `/workspace/${workspaceId}/settings/subscription`
  const buttonLabel = data.action === 'upgrade_plan' ? 'Upgrade Plan' : 'Increase Limit'

  return (
    <div className='rounded-xl border border-amber-300/40 bg-amber-50/50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-950/20'>
      <div className='flex items-center gap-2'>
        <svg
          className='h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400'
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
        <ArrowRight className='h-3 w-3' />
      </a>
    </div>
  )
}
