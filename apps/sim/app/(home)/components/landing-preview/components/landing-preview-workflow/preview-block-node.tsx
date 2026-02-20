'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'
import { Database } from 'lucide-react'
import { Handle, type NodeProps, Position } from 'reactflow'
import {
  AgentIcon,
  AnthropicIcon,
  FirecrawlIcon,
  GeminiIcon,
  GithubIcon,
  GmailIcon,
  GoogleCalendarIcon,
  GoogleSheetsIcon,
  JiraIcon,
  LinearIcon,
  LinkedInIcon,
  MistralIcon,
  NotionIcon,
  OpenAIIcon,
  RedditIcon,
  ReductoIcon,
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
} from '@/app/(home)/components/landing-preview/components/landing-preview-workflow/workflow-data'

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
  linear: LinearIcon,
  firecrawl: FirecrawlIcon,
  reddit: RedditIcon,
  notion: NotionIcon,
  reducto: ReductoIcon,
  textract: TextractIcon,
  linkedin: LinkedInIcon,
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
 * --workflow-edge in dark mode: #454545
 */
const HANDLE_BASE = '!z-[10] !border-none !bg-[#454545]'
const HANDLE_LEFT = `${HANDLE_BASE} !left-[-8px] !h-5 !w-[7px] !rounded-r-none !rounded-l-[2px]`
const HANDLE_RIGHT = `${HANDLE_BASE} !right-[-8px] !h-5 !w-[7px] !rounded-l-none !rounded-r-[2px]`

/**
 * Static preview block node matching the real WorkflowBlock styling.
 * Renders a block header with icon + name, sub-block rows, and tool chips.
 *
 * Colors sourced from dark theme CSS variables:
 * --surface-2: #232323, --border-1: #3d3d3d
 * --text-primary: #e6e6e6, --text-tertiary: #b3b3b3
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
      <motion.div
        className='relative'
        initial={animate ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.45, delay, ease: EASE_OUT }}
      >
        <div className='w-[280px] select-none rounded-[8px] border border-[#3d3d3d] bg-[#232323]'>
          <div className='border-[#3d3d3d] border-b p-[8px]'>
            <span className='font-medium text-[#e6e6e6] text-[16px]'>Note</span>
          </div>
          <div className='p-[10px]'>
            <NoteMarkdown content={markdown} />
          </div>
        </div>
      </motion.div>
    )
  }

  const hasContent = rows.length > 0 || (tools && tools.length > 0)

  return (
    <motion.div
      className='relative'
      initial={animate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.45, delay, ease: EASE_OUT }}
    >
      <div className='relative z-[20] w-[250px] select-none rounded-[8px] border border-[#3d3d3d] bg-[#232323]'>
        {/* Target handle (left side) */}
        {!hideTargetHandle && (
          <Handle
            type='target'
            position={Position.Left}
            id='target'
            className={HANDLE_LEFT}
            style={{ top: '20px', transform: 'translateY(-50%)' }}
            isConnectableStart={false}
            isConnectableEnd={false}
          />
        )}

        {/* Header */}
        <div
          className={`flex items-center justify-between p-[8px] ${hasContent ? 'border-[#3d3d3d] border-b' : ''}`}
        >
          <div className='relative z-10 flex min-w-0 flex-1 items-center gap-[10px]'>
            <div
              className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-[6px]'
              style={{ background: bgColor }}
            >
              {Icon && <Icon className='h-[16px] w-[16px] text-white' />}
            </div>
            <span className='truncate font-medium text-[#e6e6e6] text-[16px]'>{name}</span>
          </div>
        </div>

        {/* Sub-block rows + tools */}
        {hasContent && (
          <div className='flex flex-col gap-[8px] p-[8px]'>
            {rows.map((row) => {
              const modelEntry = row.title === 'Model' ? getModelIconEntry(row.value) : null
              const ModelIcon = modelEntry?.icon
              return (
                <div key={row.title} className='flex items-center gap-[8px]'>
                  <span className='flex-shrink-0 font-normal text-[#b3b3b3] text-[14px] capitalize'>
                    {row.title}
                  </span>
                  {row.value && (
                    <span className='flex min-w-0 flex-1 items-center justify-end gap-[5px] font-normal text-[#e6e6e6] text-[14px]'>
                      {ModelIcon && (
                        <ModelIcon
                          className={`inline-block flex-shrink-0 text-[#e6e6e6] ${modelEntry.size ?? 'h-[14px] w-[14px]'}`}
                        />
                      )}
                      <span className='truncate'>{row.value}</span>
                    </span>
                  )}
                </div>
              )
            })}

            {/* Tool chips — inline with label */}
            {tools && tools.length > 0 && (
              <div className='flex items-center gap-[8px]'>
                <span className='flex-shrink-0 font-normal text-[#b3b3b3] text-[14px]'>Tools</span>
                <div className='flex flex-1 flex-wrap items-center justify-end gap-[5px]'>
                  {tools.map((tool) => {
                    const ToolIcon = BLOCK_ICONS[tool.type]
                    return (
                      <div
                        key={tool.type}
                        className='flex items-center gap-[5px] rounded-[5px] border border-[#3d3d3d] bg-[#2a2a2a] px-[6px] py-[3px]'
                      >
                        <div
                          className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[4px]'
                          style={{ background: tool.bgColor }}
                        >
                          {ToolIcon && <ToolIcon className='h-[10px] w-[10px] text-white' />}
                        </div>
                        <span className='font-normal text-[#e6e6e6] text-[12px]'>{tool.name}</span>
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
            style={{ top: '20px', transform: 'translateY(-50%)' }}
            isConnectableStart={false}
            isConnectableEnd={false}
          />
        )}
      </div>
    </motion.div>
  )
})

/**
 * Renders lightweight markdown-like content for note blocks.
 * Supports ### headings, **bold**, _italic_, --- rules, and blank-line spacing.
 */
function NoteMarkdown({ content }: { content: string }) {
  const lines = content.split('\n')

  return (
    <div className='flex flex-col gap-[4px]'>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className='h-[4px]' />

        if (trimmed === '---') {
          return <hr key={i} className='my-[4px] border-[#3d3d3d] border-t' />
        }

        if (trimmed.startsWith('### ')) {
          return (
            <p key={i} className='font-semibold text-[#e6e6e6] text-[16px] leading-[1.3]'>
              {trimmed.slice(4)}
            </p>
          )
        }

        return (
          <p
            key={i}
            className='font-medium text-[#e6e6e6] text-[13px] leading-[1.5]'
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
