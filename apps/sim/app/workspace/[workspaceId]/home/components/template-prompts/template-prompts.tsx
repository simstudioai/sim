'use client'

import { type ComponentType, memo, type SVGProps, useCallback, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { AgentIcon, ScheduleIcon, StartIcon } from '@/components/icons'
import { cn } from '@/lib/core/utils/cn'
import type { Category, ModuleTag } from './consts'
import { IntegrationIconStack } from './components/integration-icon-stack'
import { CATEGORY_META, TEMPLATES } from './consts'

const CATEGORIES = Object.entries(CATEGORY_META) as [Category, (typeof CATEGORY_META)[Category]][]

const MINI_TABLE_DATA = [
  ['Sarah Chen', 'sarah@acme.co', 'Acme Inc', 'Qualified'],
  ['James Park', 'james@globex.io', 'Globex', 'New'],
  ['Maria Santos', 'maria@initech.com', 'Initech', 'Contacted'],
  ['Alex Kim', 'alex@umbrella.co', 'Umbrella', 'Qualified'],
  ['Emma Wilson', 'emma@stark.io', 'Stark Ind', 'New'],
] as const

const STATUS_DOT: Record<string, string> = {
  Qualified: 'bg-emerald-400',
  New: 'bg-blue-400',
  Contacted: 'bg-amber-400',
}

const MINI_KB_DATA = [
  ['product-specs.pdf', '4.2 MB', '12.4k', 'Enabled'],
  ['eng-handbook.md', '1.8 MB', '8.2k', 'Enabled'],
  ['api-reference.json', '920 KB', '4.1k', 'Enabled'],
  ['release-notes.md', '340 KB', '2.8k', 'Enabled'],
  ['onboarding.pdf', '2.1 MB', '6.5k', 'Processing'],
] as const

const KB_BADGE: Record<string, string> = {
  Enabled: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  Processing: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
}

interface WorkflowBlockDef {
  color: string
  name: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  rows: { title: string; value: string }[]
}

function PreviewTable() {
  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--surface-2)]'>
      <div className='flex shrink-0 items-center border-[var(--border-1)] border-b bg-[var(--surface-3)]'>
        {['Name', 'Email', 'Company', 'Status'].map((col) => (
          <div key={col} className='flex flex-1 items-center px-1.5 py-[5px]'>
            <span className='font-medium text-[7px] text-[var(--text-tertiary)]'>{col}</span>
          </div>
        ))}
      </div>
      {MINI_TABLE_DATA.map((row, i) => (
        <div key={i} className='flex items-center border-[var(--border-1)] border-b'>
          {row.map((cell, j) => (
            <div key={j} className='flex flex-1 items-center px-1.5 py-[2.5px]'>
              {j === 3 ? (
                <div className='flex items-center gap-[3px]'>
                  <div className={`h-[4px] w-[4px] shrink-0 rounded-full ${STATUS_DOT[cell]}`} />
                  <span className='text-[6.5px] text-[var(--text-tertiary)]'>{cell}</span>
                </div>
              ) : (
                <span
                  className={`truncate text-[7px] leading-[1.2] ${j === 0 ? 'font-medium text-[var(--text-body)]' : 'text-[var(--text-tertiary)]'}`}
                >
                  {cell}
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function PreviewKnowledge() {
  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--surface-2)]'>
      <div className='flex shrink-0 items-center border-[var(--border-1)] border-b bg-[var(--surface-3)]'>
        {['Name', 'Size', 'Tokens', 'Status'].map((col) => (
          <div key={col} className='flex flex-1 items-center px-1.5 py-[5px]'>
            <span className='font-medium text-[7px] text-[var(--text-tertiary)]'>{col}</span>
          </div>
        ))}
      </div>
      {MINI_KB_DATA.map((row, i) => (
        <div key={i} className='flex items-center border-[var(--border-1)] border-b'>
          <div className='flex flex-1 items-center px-1.5 py-[2.5px]'>
            <span className='truncate font-medium text-[7px] text-[var(--text-body)] leading-[1.2]'>
              {row[0]}
            </span>
          </div>
          <div className='flex flex-1 items-center px-1.5 py-[2.5px]'>
            <span className='text-[7px] text-[var(--text-tertiary)] leading-[1.2]'>{row[1]}</span>
          </div>
          <div className='flex flex-1 items-center px-1.5 py-[2.5px]'>
            <span className='text-[7px] text-[var(--text-tertiary)] leading-[1.2]'>{row[2]}</span>
          </div>
          <div className='flex flex-1 items-center px-1.5 py-[2.5px]'>
            <span className={`inline-block rounded-full px-1 py-px text-[6px] ${KB_BADGE[row[3]]}`}>
              {row[3]}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

function PreviewFile() {
  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--surface-2)]'>
      <div className='flex shrink-0 items-center gap-1 border-[var(--border-1)] border-b px-2.5 py-[5px]'>
        <span className='text-[7px] text-[var(--text-tertiary)]'>Files</span>
        <span className='text-[7px] text-[var(--text-tertiary)] opacity-40'>/</span>
        <span className='font-medium text-[7px] text-[var(--text-body)]'>meeting-notes.md</span>
      </div>
      <div className='flex-1 overflow-hidden px-2.5 py-1.5'>
        <p className='font-semibold text-[8px] text-[var(--text-body)]'>Meeting Notes</p>
        <p className='mt-1 font-medium text-[7px] text-[var(--text-body)]'>Action Items</p>
        <p className='mt-[1px] text-[6.5px] text-[var(--text-tertiary)]'>
          • Review Q1 metrics with Sarah
        </p>
        <p className='text-[6.5px] text-[var(--text-tertiary)]'>• Update API documentation</p>
        <p className='text-[6.5px] text-[var(--text-tertiary)]'>
          • Schedule design review for v2.0
        </p>
        <p className='mt-1 font-medium text-[7px] text-[var(--text-body)]'>Discussion Points</p>
        <p className='mt-[1px] text-[6.5px] text-[var(--text-tertiary)]'>
          The team agreed to prioritize the new onboarding flow...
        </p>
        <p className='mt-1 font-medium text-[7px] text-[var(--text-body)]'>Next Steps</p>
        <p className='mt-[1px] text-[6.5px] text-[var(--text-tertiary)]'>
          Follow up with engineering on the API v2 migration.
        </p>
      </div>
    </div>
  )
}

const WorkflowMiniBlock = memo(function WorkflowMiniBlock({
  color,
  name,
  icon: Icon,
  rows,
}: WorkflowBlockDef) {
  const hasRows = rows.length > 0
  return (
    <div className='w-[76px] rounded-sm border border-[var(--border-1)] bg-[var(--white)] dark:bg-[var(--surface-4)]'>
      <div
        className={`flex items-center gap-1 px-[5px] py-[3px] ${hasRows ? 'border-[var(--border-1)] border-b' : ''}`}
      >
        <div
          className='flex h-[11px] w-[11px] shrink-0 items-center justify-center rounded-[3px]'
          style={{ backgroundColor: color }}
        >
          <Icon className='h-[7px] w-[7px] text-white' />
        </div>
        <span className='truncate font-medium text-[6.5px] text-[var(--text-body)]'>{name}</span>
      </div>
      {rows.map((row) => (
        <div key={row.title} className='flex items-center gap-[3px] px-[5px] py-0.5'>
          <span className='shrink-0 text-[5.5px] text-[var(--text-tertiary)]'>{row.title}</span>
          <span className='ml-auto truncate text-[5.5px] text-[var(--text-body)]'>{row.value}</span>
        </div>
      ))}
    </div>
  )
})

function buildWorkflowBlocks(template: (typeof TEMPLATES)[number]): WorkflowBlockDef[] {
  const modules = template.modules
  const toolName = template.title.split(' ')[0]
  const hasAgent = modules.includes('agent')
  const isScheduled = modules.includes('scheduled')

  const starter: WorkflowBlockDef = isScheduled
    ? {
        color: '#6366F1',
        name: 'Schedule',
        icon: ScheduleIcon,
        rows: [{ title: 'Cron', value: '0 9 * * 1' }],
      }
    : {
        color: '#2FB3FF',
        name: 'Starter',
        icon: StartIcon,
        rows: [{ title: 'Trigger', value: 'Manual' }],
      }

  const agent: WorkflowBlockDef = {
    color: '#802FFF',
    name: 'Agent',
    icon: AgentIcon,
    rows: [{ title: 'Model', value: 'gpt-4o' }],
  }

  const tool: WorkflowBlockDef = {
    color: '#3B3B3B',
    name: toolName,
    icon: template.icon,
    rows: [{ title: 'Action', value: 'Run' }],
  }

  if (hasAgent) return [starter, agent, tool]
  return [starter, tool]
}

const BLOCK_W = 76
const EDGE_W = 14

function PreviewWorkflow({ template }: { template: (typeof TEMPLATES)[number] }) {
  const blocks = buildWorkflowBlocks(template)
  const goesUp = template.title.charCodeAt(0) % 2 === 0

  const twoBlock = blocks.length === 2
  const offsets = twoBlock
    ? goesUp
      ? [-10, 10]
      : [10, -10]
    : goesUp
      ? [-12, 12, -12]
      : [12, -12, 12]

  const totalW = blocks.length * BLOCK_W + (blocks.length - 1) * EDGE_W

  return (
    <div className='flex h-full w-full items-center justify-center bg-[var(--surface-2)]'>
      <div className='relative' style={{ width: totalW, height: 70 }}>
        <svg
          className='pointer-events-none absolute top-0 left-0 z-0'
          width={totalW}
          height={70}
          fill='none'
          style={{ overflow: 'visible' }}
        >
          {blocks.slice(1).map((_, i) => {
            const x1 = i * (BLOCK_W + EDGE_W) + BLOCK_W
            const y1 = 35 + offsets[i]
            const x2 = (i + 1) * (BLOCK_W + EDGE_W)
            const y2 = 35 + offsets[i + 1]
            const midX = (x1 + x2) / 2
            return (
              <path
                key={i}
                d={`M${x1},${y1} C${midX},${y1} ${midX},${y2} ${x2},${y2}`}
                className='stroke-[var(--text-icon)]'
                strokeWidth={1}
                opacity={0.3}
              />
            )
          })}
        </svg>

        {blocks.map((block, i) => {
          const x = i * (BLOCK_W + EDGE_W)
          const yCenter = 35 + offsets[i]
          return (
            <div key={block.name} className='absolute z-10' style={{ left: x, top: yCenter - 20 }}>
              <WorkflowMiniBlock {...block} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function TemplatePreview({
  modules,
  template,
}: {
  modules: ModuleTag[]
  template: (typeof TEMPLATES)[number]
}) {
  if (modules.includes('tables')) return <PreviewTable />
  if (modules.includes('knowledge-base')) return <PreviewKnowledge />
  if (modules.includes('files')) return <PreviewFile />
  return <PreviewWorkflow template={template} />
}

interface TemplatePromptsProps {
  onSelect: (prompt: string) => void
}

export function TemplatePrompts({ onSelect }: TemplatePromptsProps) {
  const [activeCategory, setActiveCategory] = useState<Category>('popular')
  const navRef = useRef<HTMLElement>(null)
  const [showLeftFade, setShowLeftFade] = useState(false)
  const [showRightFade, setShowRightFade] = useState(true)

  const handleNavScroll = useCallback(() => {
    const el = navRef.current
    if (!el) return
    setShowLeftFade(el.scrollLeft > 2)
    setShowRightFade(el.scrollLeft < el.scrollWidth - el.clientWidth - 2)
  }, [])

  const visibleTemplates = useMemo(
    () =>
      activeCategory === 'popular'
        ? TEMPLATES.filter((t) => t.featured)
        : TEMPLATES.filter((t) => t.category === activeCategory),
    [activeCategory]
  )

  return (
    <div className='flex flex-col gap-4 lg:gap-5'>
      <div className='flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-4'>
        <h3 className='shrink-0 font-medium text-[var(--text-secondary)] text-large'>
          Start with a template
        </h3>
        <div className='relative md:contents'>
          {showLeftFade && (
            <div aria-hidden='true' className='pointer-events-none absolute top-0 bottom-0 left-0 z-10 w-8 bg-gradient-to-r from-[var(--bg)] to-transparent md:hidden' />
          )}
          <nav
            ref={navRef}
            onScroll={handleNavScroll}
            className='flex flex-nowrap gap-1.5 overflow-x-auto [scrollbar-width:none] [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden md:flex-wrap md:justify-end md:overflow-x-visible'
            aria-label='Template categories'
          >
            {CATEGORIES.map(([key, meta]) => {
              const Icon = meta.icon
              const isActive = activeCategory === key
              return (
                <button
                  key={key}
                  type='button'
                  onClick={() => setActiveCategory(key)}
                  aria-pressed={isActive}
                  className={cn(
                    'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-[40px] border px-3 py-1 text-xs font-medium transition-colors duration-150 ease-out',
                    isActive
                      ? 'border-[var(--border-1)] bg-[var(--surface-active)] text-[var(--text-primary)] hover-hover:bg-[var(--surface-hover)]'
                      : 'border-[var(--border-1)] text-[var(--text-secondary)] hover-hover:bg-[var(--surface-hover)] hover-hover:text-[var(--text-primary)]'
                  )}
                >
                  <Icon className='h-3 w-3' />
                  {meta.label}
                </button>
              )
            })}
          </nav>
          {showRightFade && (
            <div aria-hidden='true' className='pointer-events-none absolute top-0 right-0 bottom-0 z-10 w-8 bg-gradient-to-l from-[var(--bg)] to-transparent md:hidden' />
          )}
        </div>
      </div>

      <div className='grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-3'>
        {visibleTemplates.map((template) => (
          <TemplateCard key={template.title} template={template} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

interface TemplateCardProps {
  template: (typeof TEMPLATES)[number]
  onSelect: (prompt: string) => void
}

const TemplateCard = memo(function TemplateCard({ template, onSelect }: TemplateCardProps) {
  const Icon = template.icon

  return (
    <button
      type='button'
      onClick={() => onSelect(template.prompt)}
      aria-label={`Select template: ${template.title}`}
      className='group flex cursor-pointer flex-col text-left'
    >
      <div className='overflow-hidden rounded-lg border border-[var(--border-1)] transition-colors group-hover:bg-[var(--surface-hover)]'>
        <div className='relative h-[120px] w-full overflow-hidden'>
          {template.image ? (
            <Image
              src={template.image}
              alt={template.title}
              fill
              unoptimized
              className='object-cover object-left-top transition-transform duration-200 group-hover:scale-[1.02]'
            />
          ) : (
            <TemplatePreview modules={template.modules} template={template} />
          )}
        </div>
        <div className='flex items-center gap-1.5 border-[var(--border-1)] border-t bg-[var(--white)] px-3 py-2 transition-colors group-hover:bg-[var(--surface-hover)] dark:bg-[var(--surface-4)]'>
          <Icon className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
          <span className='truncate text-[var(--text-body)] text-small'>{template.title}</span>
          <IntegrationIconStack blockTypes={template.integrationBlockTypes} />
        </div>
      </div>
    </button>
  )
})
