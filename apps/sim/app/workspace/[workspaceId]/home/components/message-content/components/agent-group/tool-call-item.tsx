'use client'

import { useEffect, useMemo, useRef } from 'react'
import { PillsRing } from '@/components/emcn'
import type { ToolCallResult, ToolCallStatus } from '../../../../types'
import { getToolIcon } from '../../utils'

/** Tools that render as cards with result data on success. */
const CARD_TOOLS = new Set<string>([
  'function_execute',
  'search_online',
  'scrape_page',
  'get_page_contents',
  'search_library_docs',
  'superagent',
  'run',
  'plan',
  'debug',
  'edit',
  'fast_edit',
  'custom_tool',
  'research',
  'job',
])

/**
 * Extract a readable preview from partial tool-call JSON.
 * For workspace_file, pulls out the "content" field value.
 * For other tools, returns the raw accumulated JSON.
 */
function extractStreamingPreview(toolName: string, raw: string): string {
  if (toolName === 'workspace_file') {
    const marker = '"content":'
    const idx = raw.indexOf(marker)
    if (idx === -1) return ''
    let rest = raw.slice(idx + marker.length).trimStart()
    if (rest.startsWith('"')) rest = rest.slice(1)
    // Unescape common JSON escape sequences for display
    return rest
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  return raw
}

function CircleCheck({ className }: { className?: string }) {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
    >
      <circle cx='8' cy='8' r='6.5' stroke='currentColor' strokeWidth='1.25' />
      <path
        d='M5.5 8.5L7 10L10.5 6.5'
        stroke='currentColor'
        strokeWidth='1.25'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  )
}

export function CircleStop({ className }: { className?: string }) {
  return (
    <svg
      width='16'
      height='16'
      viewBox='0 0 16 16'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      className={className}
    >
      <circle cx='8' cy='8' r='6.5' stroke='currentColor' strokeWidth='1.25' />
      <rect x='6' y='6' width='4' height='4' rx='0.5' fill='currentColor' />
    </svg>
  )
}

function StatusIcon({ status, toolName }: { status: ToolCallStatus; toolName: string }) {
  if (status === 'executing') {
    return <PillsRing className='h-[15px] w-[15px] text-[var(--text-tertiary)]' animate />
  }
  if (status === 'cancelled') {
    return <CircleStop className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
  }
  const Icon = getToolIcon(toolName)
  if (Icon) {
    return <Icon className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
  }
  return <CircleCheck className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
}

function FlatToolLine({
  toolName,
  displayTitle,
  status,
}: {
  toolName: string
  displayTitle: string
  status: ToolCallStatus
}) {
  return (
    <div className='flex items-center gap-[8px] pl-[24px]'>
      <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
        <StatusIcon status={status} toolName={toolName} />
      </div>
      <span className='font-base text-[13px] text-[var(--text-secondary)]'>{displayTitle}</span>
    </div>
  )
}

function formatToolOutput(output: unknown): string {
  if (output === null || output === undefined) return ''
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

interface ToolCallItemProps {
  toolName: string
  displayTitle: string
  status: ToolCallStatus
  result?: ToolCallResult
  streamingArgs?: string
}

export function ToolCallItem({
  toolName,
  displayTitle,
  status,
  result,
  streamingArgs,
}: ToolCallItemProps) {
  const showCard =
    CARD_TOOLS.has(toolName) &&
    status === 'success' &&
    result?.output !== undefined &&
    result?.output !== null

  if (showCard) {
    return <ToolCallCard toolName={toolName} displayTitle={displayTitle} result={result!} />
  }

  if (streamingArgs && status === 'executing') {
    return (
      <StreamingToolCard
        toolName={toolName}
        displayTitle={displayTitle}
        streamingArgs={streamingArgs}
      />
    )
  }

  return <FlatToolLine toolName={toolName} displayTitle={displayTitle} status={status} />
}

function StreamingToolCard({
  toolName,
  displayTitle,
  streamingArgs,
}: {
  toolName: string
  displayTitle: string
  streamingArgs: string
}) {
  const preview = useMemo(
    () => extractStreamingPreview(toolName, streamingArgs),
    [toolName, streamingArgs]
  )
  const scrollRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [preview])

  return (
    <div className='pl-[24px]'>
      <div className='overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-3)]'>
        <div className='flex items-center gap-[8px] px-[10px] py-[6px]'>
          <PillsRing className='h-[15px] w-[15px] text-[var(--text-tertiary)]' animate />
          <span className='font-base text-[13px] text-[var(--text-secondary)]'>{displayTitle}</span>
        </div>
        {preview && (
          <div className='border-[var(--border)] border-t px-[10px] py-[6px]'>
            <pre
              ref={scrollRef}
              className='max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[12px] text-[var(--text-body)] leading-[1.5]'
            >
              {preview}
              <span className='inline-block h-[14px] w-[1px] animate-pulse bg-[var(--text-tertiary)]' />
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

function ToolCallCard({
  toolName,
  displayTitle,
  result,
}: {
  toolName: string
  displayTitle: string
  result: ToolCallResult
}) {
  const body = useMemo(() => formatToolOutput(result.output), [result.output])
  const Icon = getToolIcon(toolName)
  const ResolvedIcon = Icon ?? CircleCheck

  return (
    <div className='animate-stream-fade-in pl-[24px]'>
      <div className='overflow-hidden rounded-[8px] border border-[var(--border)] bg-[var(--surface-3)]'>
        <div className='flex items-center gap-[8px] px-[10px] py-[6px]'>
          <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
            <ResolvedIcon className='h-[15px] w-[15px] text-[var(--text-tertiary)]' />
          </div>
          <span className='font-base text-[13px] text-[var(--text-secondary)]'>{displayTitle}</span>
        </div>
        {body && (
          <div className='border-[var(--border)] border-t px-[10px] py-[6px]'>
            <pre className='max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all font-mono text-[12px] text-[var(--text-body)] leading-[1.5]'>
              {body}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
