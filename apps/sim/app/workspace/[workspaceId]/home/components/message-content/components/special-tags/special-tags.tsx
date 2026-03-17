'use client'

import { createElement } from 'react'
import { useParams } from 'next/navigation'
import { ArrowRight } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'

export interface OptionsItemData {
  title: string
  description?: string
}

export type OptionsTagData = Record<string, OptionsItemData | string>

export interface UsageUpgradeTagData {
  reason: string
  action: 'upgrade_plan' | 'increase_limit'
  message: string
}

export interface CredentialTagData {
  value: string
  type: 'env_key' | 'oauth_key' | 'sim_key' | 'credential_id' | 'link'
  provider?: string
}

export type ContentSegment =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'options'; data: OptionsTagData }
  | { type: 'usage_upgrade'; data: UsageUpgradeTagData }
  | { type: 'credential'; data: CredentialTagData }

export interface ParsedSpecialContent {
  segments: ContentSegment[]
  hasPendingTag: boolean
}

const SPECIAL_TAG_NAMES = ['thinking', 'options', 'usage_upgrade', 'credential'] as const

/**
 * Parses inline special tags (`<options>`, `<usage_upgrade>`) from streamed
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
    let nearestTagName = ''

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
        const partial = remaining.match(/<[a-z_]*$/i)
        if (partial) {
          const fragment = partial[0].slice(1)
          if (fragment.length > 0 && SPECIAL_TAG_NAMES.some((t) => t.startsWith(fragment))) {
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
    if (nearestTagName === 'thinking') {
      if (body.trim()) {
        segments.push({ type: 'thinking', content: body })
      }
    } else {
      try {
        const data = JSON.parse(body)
        segments.push({ type: nearestTagName as 'options' | 'usage_upgrade' | 'credential', data })
      } catch {
        /* malformed JSON — drop the tag silently */
      }
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
}

/**
 * Unified renderer for inline special tags: `<options>`, `<usage_upgrade>`, and `<credential>`.
 */
export function SpecialTags({ segment, onOptionSelect }: SpecialTagsProps) {
  switch (segment.type) {
    case 'thinking':
      return null
    case 'options':
      return <OptionsDisplay data={segment.data} onSelect={onOptionSelect} />
    case 'usage_upgrade':
      return <UsageUpgradeDisplay data={segment.data} />
    case 'credential':
      return <CredentialDisplay data={segment.data} />
    default:
      return null
  }
}

/**
 * Renders a "Thinking" shimmer while a special tag is still streaming in.
 */
export function PendingTagIndicator() {
  return (
    <div className='flex animate-stream-fade-in items-center gap-[8px] py-[8px]'>
      <div className='grid h-[16px] w-[16px] grid-cols-2 gap-[1.5px]'>
        {THINKING_BLOCKS.map((block, i) => (
          <div
            key={i}
            className='animate-thinking-block rounded-[2px]'
            style={{ backgroundColor: block.color, animationDelay: block.delay }}
          />
        ))}
      </div>
      <span className='font-base text-[14px] text-[var(--text-body)]'>Thinking…</span>
    </div>
  )
}

interface OptionsDisplayProps {
  data: OptionsTagData
  onSelect?: (id: string) => void
}

function OptionsDisplay({ data, onSelect }: OptionsDisplayProps) {
  const entries = Object.entries(data)
  if (entries.length === 0) return null

  const disabled = !onSelect

  return (
    <div className='animate-stream-fade-in'>
      <span className='font-base text-[14px] text-[var(--text-body)]'>Suggested follow-ups</span>
      <div className='mt-1.5 flex flex-col'>
        {entries.map(([key, value], i) => {
          const title = typeof value === 'string' ? value : value.title

          return (
            <button
              key={key}
              type='button'
              disabled={disabled}
              onClick={() => onSelect?.(title)}
              className={cn(
                'flex items-center gap-[8px] border-[var(--divider)] px-[8px] py-[8px] text-left transition-colors',
                disabled ? 'cursor-not-allowed' : 'hover:bg-[var(--surface-5)]',
                i > 0 && 'border-t'
              )}
            >
              <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                <span className='font-base text-[14px] text-[var(--text-icon)]'>{i + 1}</span>
              </div>
              <span className='flex-1 font-base text-[14px] text-[var(--text-body)]'>{title}</span>
              <ArrowRight className='h-[16px] w-[16px] shrink-0 text-[var(--text-icon)]' />
            </button>
          )
        })}
      </div>
    </div>
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
      className='flex animate-stream-fade-in items-center gap-[8px] rounded-lg border border-[var(--divider)] px-3 py-2.5 transition-colors hover:bg-[var(--surface-5)]'
    >
      {createElement(Icon, { className: 'h-[16px] w-[16px] shrink-0' })}
      <span className='flex-1 font-base text-[14px] text-[var(--text-body)]'>
        Connect {data.provider}
      </span>
      <ArrowRight className='h-[16px] w-[16px] shrink-0 text-[var(--text-icon)]' />
    </a>
  )
}

function UsageUpgradeDisplay({ data }: { data: UsageUpgradeTagData }) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const settingsPath = `/workspace/${workspaceId}/settings/subscription`
  const buttonLabel = data.action === 'upgrade_plan' ? 'Upgrade Plan' : 'Increase Limit'

  return (
    <div className='animate-stream-fade-in rounded-xl border border-amber-300/40 bg-amber-50/50 px-4 py-3 dark:border-amber-500/20 dark:bg-amber-950/20'>
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
        <span className='font-[500] text-[14px] text-amber-800 leading-5 dark:text-amber-300'>
          Usage Limit Reached
        </span>
      </div>
      <p className='mt-1.5 text-[13px] text-amber-700/90 leading-[20px] dark:text-amber-400/80'>
        {data.message}
      </p>
      <a
        href={settingsPath}
        className='mt-2 inline-flex items-center gap-1 font-[500] text-[13px] text-amber-700 underline decoration-dashed underline-offset-2 transition-colors hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200'
      >
        {buttonLabel}
        <ArrowRight className='h-3 w-3' />
      </a>
    </div>
  )
}
