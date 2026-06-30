'use client'

import { memo } from 'react'
import { domAnimation, LazyMotion, m } from 'framer-motion'
import { Database } from 'lucide-react'
import { Handle, type NodeProps, Position } from 'reactflow'
import { Blimp } from '@/components/emcn'
import {
  AgentIcon,
  AnthropicIcon,
  FirecrawlIcon,
  GeminiIcon,
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleSheetsIcon,
  HubspotIcon,
  JiraIcon,
  LinearIcon,
  LinkedInIcon,
  MistralIcon,
  NotionIcon,
  OpenAIIcon,
  RedditIcon,
  ReductoIcon,
  SalesforceIcon,
  ScheduleIcon,
  SlackIcon,
  StartIcon,
  SupabaseIcon,
  TelegramIcon,
  TextractIcon,
  WebhookIcon,
  xAIIcon,
  xIcon,
  YouTubeIcon,
} from '@/components/icons'
import {
  BLOCK_STAGGER,
  EASE_OUT,
  type PreviewTool,
} from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/workflow-data'

/** Map block type strings to their icon components. */
const BLOCK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  starter: StartIcon,
  start_trigger: StartIcon,
  agent: AgentIcon,
  slack: SlackIcon,
  jira: JiraIcon,
  x: xIcon,
  youtube: YouTubeIcon,
  schedule: ScheduleIcon,
  telegram: TelegramIcon,
  knowledge_base: Database,
  webhook: WebhookIcon,
  github: GithubIcon,
  supabase: SupabaseIcon,
  google_calendar: GoogleCalendarIcon,
  gmail: GmailIcon,
  google_sheets: GoogleSheetsIcon,
  hubspot: HubspotIcon,
  linear: LinearIcon,
  firecrawl: FirecrawlIcon,
  reddit: RedditIcon,
  notion: NotionIcon,
  reducto: ReductoIcon,
  salesforce: SalesforceIcon,
  textract: TextractIcon,
  linkedin: LinkedInIcon,
  mothership: Blimp,
}

/** Model prefix → provider icon for the "Model" row in agent blocks. */
const MODEL_PROVIDER_ICONS: Array<{
  prefix: string
  icon: React.ComponentType<{ className?: string }>
  size?: string
}> = [
  { prefix: 'gpt-', icon: OpenAIIcon },
  { prefix: 'o3', icon: OpenAIIcon },
  { prefix: 'o4', icon: OpenAIIcon },
  { prefix: 'claude-', icon: AnthropicIcon },
  { prefix: 'gemini-', icon: GeminiIcon },
  { prefix: 'grok-', icon: xAIIcon, size: 'h-[17px] w-[17px]' },
  { prefix: 'mistral-', icon: MistralIcon },
]

function getModelIconEntry(modelValue: string) {
  const lower = modelValue.toLowerCase()
  return MODEL_PROVIDER_ICONS.find((m) => lower.startsWith(m.prefix)) ?? null
}

/**
 * Data shape for preview block nodes
 */
interface PreviewBlockData {
  name: string
  blockType: string
  bgColor: string
  rows: Array<{ title: string; value: string }>
  tools?: PreviewTool[]
  markdown?: string
  hideTargetHandle?: boolean
  hideSourceHandle?: boolean
  index?: number
  animate?: boolean
}

/**
 * Handle styling matching the real WorkflowBlock handles.
 * --workflow-edge in dark mode: #c9c9c9
 */
const HANDLE_BASE = '!z-[10] !top-5 !-translate-y-1/2 !border-none !bg-[var(--surface-7)]'
const HANDLE_LEFT = `${HANDLE_BASE} !left-[-8px] !h-5 !w-[7px] !rounded-r-none !rounded-l-[2px]`
const HANDLE_RIGHT = `${HANDLE_BASE} !right-[-8px] !h-5 !w-[7px] !rounded-l-none !rounded-r-[2px]`

/**
 * Static preview block node matching the real WorkflowBlock styling.
 * Renders a block header with icon + name, sub-block rows, and tool chips.
 *
 * Colors sourced from dark theme CSS variables:
 * --surface-2: #ffffff, --border-1: #e6e6e6
 * --text-primary: #121212, --text-tertiary: #5f5f5f
 */
export const PreviewBlockNode = memo(function PreviewBlockNode({
  data,
}: NodeProps<PreviewBlockData>) {
  const {
    name,
    blockType,
    bgColor,
    rows,
    tools,
    markdown,
    hideTargetHandle,
    hideSourceHandle,
    index = 0,
    animate = false,
  } = data
  const Icon = BLOCK_ICONS[blockType]
  const delay = animate ? index * BLOCK_STAGGER : 0

  if (blockType === 'note' && markdown) {
    return (
      <LazyMotion features={domAnimation}>
        <m.div
          className='relative'
          initial={animate ? { opacity: 0 } : false}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay, ease: EASE_OUT }}
        >
          <div className='w-[280px] select-none rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)]'>
            <div className='border-[var(--border)] border-b p-2'>
              <span className='font-medium text-[16px] text-[var(--text-primary)]'>Note</span>
            </div>
            <div className='p-2.5'>
              <NoteMarkdown content={markdown} />
            </div>
          </div>
        </m.div>
      </LazyMotion>
    )
  }

  const hasContent = rows.length > 0 || (tools && tools.length > 0)

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className='relative'
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, delay, ease: EASE_OUT }}
      >
        <div className='relative z-[20] w-[250px] select-none rounded-[8px] border border-[var(--border-1)] bg-[var(--surface-2)]'>
          {/* Target handle (left side) */}
          {!hideTargetHandle && (
            <Handle
              type='target'
              position={Position.Left}
              id='target'
              className={HANDLE_LEFT}
              isConnectableStart={false}
              isConnectableEnd={false}
            />
          )}

          {/* Header */}
          <div
            className={`flex items-center justify-between p-2 ${hasContent ? 'border-[var(--border)] border-b' : ''}`}
          >
            <div className='relative z-10 flex min-w-0 flex-1 items-center gap-2.5'>
              <div
                className='flex size-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
                style={{ background: bgColor }}
              >
                {Icon && <Icon className='size-[16px] text-white' />}
              </div>
              <span className='truncate font-medium text-[16px] text-[var(--text-primary)]'>
                {name}
              </span>
            </div>
          </div>

          {/* Sub-block rows + tools */}
          {hasContent && (
            <div className='flex flex-col gap-2 p-2'>
              {rows.map((row) => {
                const modelEntry = row.title === 'Model' ? getModelIconEntry(row.value) : null
                const ModelIcon = modelEntry?.icon
                return (
                  <div key={row.title} className='flex items-center gap-2'>
                    <span className='flex-shrink-0 font-normal text-[14px] text-[var(--text-muted)] capitalize'>
                      {row.title}
                    </span>
                    {row.value && (
                      <span className='flex min-w-0 flex-1 items-center justify-end gap-2 font-normal text-[14px] text-[var(--text-primary)]'>
                        {ModelIcon && (
                          <ModelIcon
                            className={`inline-block flex-shrink-0 text-[var(--text-primary)] ${modelEntry.size ?? 'h-[14px] w-[14px]'}`}
                          />
                        )}
                        <span className='truncate'>{row.value}</span>
                      </span>
                    )}
                  </div>
                )
              })}

              {/* Tool chips - inline with label */}
              {tools && tools.length > 0 && (
                <div className='flex items-center gap-2'>
                  <span className='flex-shrink-0 font-normal text-[14px] text-[var(--text-muted)]'>
                    Tools
                  </span>
                  <div className='flex flex-1 flex-wrap items-center justify-end gap-[5px]'>
                    {tools.map((tool) => {
                      const ToolIcon = BLOCK_ICONS[tool.type]
                      return (
                        <div
                          key={tool.type}
                          className='flex items-center gap-[5px] rounded-[5px] border border-[var(--border-1)] bg-[var(--surface-1)] px-[6px] py-[3px]'
                        >
                          <div
                            className='flex size-[16px] flex-shrink-0 items-center justify-center rounded-[4px]'
                            style={{ background: tool.bgColor }}
                          >
                            {ToolIcon && <ToolIcon className='size-[10px] text-white' />}
                          </div>
                          <span className='font-normal text-[12px] text-[var(--text-primary)]'>
                            {tool.name}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Source handle (right side) */}
          {!hideSourceHandle && (
            <Handle
              type='source'
              position={Position.Right}
              id='source'
              className={HANDLE_RIGHT}
              isConnectableStart={false}
              isConnectableEnd={false}
            />
          )}
        </div>
      </m.div>
    </LazyMotion>
  )
})

/**
 * Renders lightweight markdown-like content for note blocks.
 * Supports ### headings, **bold**, _italic_, --- rules, and blank-line spacing.
 */
function NoteMarkdown({ content }: { content: string }) {
  const lines = content.split('\n')

  return (
    <div className='flex flex-col gap-1'>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className='h-[4px]' />

        if (trimmed === '---') {
          return <hr key={i} className='my-1 border-[var(--border)] border-t' />
        }

        if (trimmed.startsWith('### ')) {
          return (
            <p
              key={i}
              className='font-semibold text-[16px] text-[var(--text-primary)] leading-[1.3]'
            >
              {trimmed.slice(4)}
            </p>
          )
        }

        return (
          <p
            key={i}
            className='font-medium text-[13px] text-[var(--text-primary)] leading-[1.5]'
            dangerouslySetInnerHTML={{
              __html: trimmed
                .replace(/\*\*_(.+?)_\*\*/g, '<strong><em>$1</em></strong>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/_"(.+?)"_/g, '<em>&ldquo;$1&rdquo;</em>')
                .replace(/_(.+?)_/g, '<em>$1</em>'),
            }}
          />
        )
      })}
    </div>
  )
}
