'use client'

import Image from 'next/image'
import type { Category, ModuleTag } from './consts'
import { CATEGORY_META, TEMPLATES } from './consts'

const FEATURED_TEMPLATES = TEMPLATES.filter((t) => t.featured)
const EXTRA_TEMPLATES = TEMPLATES.filter((t) => !t.featured)

function getGroupedExtras() {
  const groups: { category: Category; label: string; templates: typeof TEMPLATES }[] = []
  const byCategory = new Map<Category, typeof TEMPLATES>()

  for (const t of EXTRA_TEMPLATES) {
    const existing = byCategory.get(t.category)
    if (existing) {
      existing.push(t)
    } else {
      const arr = [t]
      byCategory.set(t.category, arr)
    }
  }

  for (const [key, meta] of Object.entries(CATEGORY_META)) {
    const cat = key as Category
    if (cat === 'popular') continue
    const items = byCategory.get(cat)
    if (items?.length) {
      groups.push({ category: cat, label: meta.label, templates: items })
    }
  }

  return groups
}

const GROUPED_EXTRAS = getGroupedExtras()

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

const WORKFLOW_COLOR = '#7C3AED'

function PreviewTable() {
  return (
    <div className='flex h-full w-full flex-col overflow-hidden bg-[var(--surface-2)]'>
      <div className='flex shrink-0 items-center border-[var(--border-1)] border-b bg-[var(--surface-3)]'>
        {['Name', 'Email', 'Company', 'Status'].map((col) => (
          <div key={col} className='flex flex-1 items-center px-[6px] py-[5px]'>
            <span className='font-medium text-[7px] text-[var(--text-tertiary)]'>{col}</span>
          </div>
        ))}
      </div>
      {MINI_TABLE_DATA.map((row, i) => (
        <div key={i} className='flex items-center border-[var(--border-1)] border-b'>
          {row.map((cell, j) => (
            <div key={j} className='flex flex-1 items-center px-[6px] py-[2.5px]'>
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
          <div key={col} className='flex flex-1 items-center px-[6px] py-[5px]'>
            <span className='font-medium text-[7px] text-[var(--text-tertiary)]'>{col}</span>
          </div>
        ))}
      </div>
      {MINI_KB_DATA.map((row, i) => (
        <div key={i} className='flex items-center border-[var(--border-1)] border-b'>
          <div className='flex flex-1 items-center px-[6px] py-[2.5px]'>
            <span className='truncate font-medium text-[7px] text-[var(--text-body)] leading-[1.2]'>
              {row[0]}
            </span>
          </div>
          <div className='flex flex-1 items-center px-[6px] py-[2.5px]'>
            <span className='text-[7px] text-[var(--text-tertiary)] leading-[1.2]'>{row[1]}</span>
          </div>
          <div className='flex flex-1 items-center px-[6px] py-[2.5px]'>
            <span className='text-[7px] text-[var(--text-tertiary)] leading-[1.2]'>{row[2]}</span>
          </div>
          <div className='flex flex-1 items-center px-[6px] py-[2.5px]'>
            <span
              className={`inline-block rounded-full px-[4px] py-px text-[6px] ${KB_BADGE[row[3]]}`}
            >
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
      <div className='flex shrink-0 items-center gap-[4px] border-[var(--border-1)] border-b px-[10px] py-[5px]'>
        <span className='text-[7px] text-[var(--text-tertiary)]'>Files</span>
        <span className='text-[7px] text-[var(--text-tertiary)] opacity-40'>/</span>
        <span className='font-medium text-[7px] text-[var(--text-body)]'>meeting-notes.md</span>
      </div>
      <div className='flex-1 overflow-hidden px-[10px] py-[6px]'>
        <p className='font-semibold text-[8px] text-[var(--text-body)]'>Meeting Notes</p>
        <p className='mt-[4px] font-medium text-[7px] text-[var(--text-body)]'>Action Items</p>
        <p className='mt-[1px] text-[6.5px] text-[var(--text-tertiary)]'>
          • Review Q1 metrics with Sarah
        </p>
        <p className='text-[6.5px] text-[var(--text-tertiary)]'>• Update API documentation</p>
        <p className='text-[6.5px] text-[var(--text-tertiary)]'>
          • Schedule design review for v2.0
        </p>
        <p className='mt-[4px] font-medium text-[7px] text-[var(--text-body)]'>Discussion Points</p>
        <p className='mt-[1px] text-[6.5px] text-[var(--text-tertiary)]'>
          The team agreed to prioritize the new onboarding flow...
        </p>
        <p className='mt-[4px] font-medium text-[7px] text-[var(--text-body)]'>Next Steps</p>
        <p className='mt-[1px] text-[6.5px] text-[var(--text-tertiary)]'>
          Follow up with engineering on the API v2 migration.
        </p>
      </div>
    </div>
  )
}

function PreviewWorkflow() {
  return (
    <div className='relative h-full w-full bg-[var(--surface-2)]'>
      <div className='absolute top-[18px] left-[18px] h-[20px] w-[20px] rounded-[4px] border border-[var(--border-2)] bg-[var(--surface-3)]' />
      <div className='absolute top-[27px] left-[38px] h-px w-[24px] bg-[var(--border-2)]' />
      <div
        className='absolute top-[18px] left-[62px] h-[20px] w-[20px] rounded-[4px] border-[2px]'
        style={{
          backgroundColor: WORKFLOW_COLOR,
          borderColor: `${WORKFLOW_COLOR}60`,
          backgroundClip: 'padding-box',
        }}
      />
      <div className='absolute top-[38px] left-[71px] h-[18px] w-px bg-[var(--border-2)]' />
      <div className='absolute top-[56px] left-[62px] h-[20px] w-[20px] rounded-[4px] border border-[var(--border-2)] bg-[var(--surface-3)]' />
      <div className='absolute top-[65px] left-[82px] h-px w-[20px] bg-[var(--border-2)]' />
      <div
        className='absolute top-[56px] left-[102px] h-[20px] w-[20px] rounded-[4px] border-[2px]'
        style={{
          backgroundColor: WORKFLOW_COLOR,
          borderColor: `${WORKFLOW_COLOR}60`,
          backgroundClip: 'padding-box',
          opacity: 0.5,
        }}
      />
    </div>
  )
}

function TemplatePreview({ modules }: { modules: ModuleTag[] }) {
  if (modules.includes('tables')) return <PreviewTable />
  if (modules.includes('knowledge-base')) return <PreviewKnowledge />
  if (modules.includes('files')) return <PreviewFile />
  return <PreviewWorkflow />
}

interface TemplatePromptsProps {
  onSelect: (prompt: string) => void
}

export function TemplatePrompts({ onSelect }: TemplatePromptsProps) {
  return (
    <div className='flex flex-col gap-[32px]'>
      <div className='grid grid-cols-3 gap-[16px]'>
        {FEATURED_TEMPLATES.map((template) => (
          <TemplateCard key={template.title} template={template} onSelect={onSelect} />
        ))}
      </div>

      {GROUPED_EXTRAS.map((group) => (
        <div key={group.category} className='flex flex-col gap-[12px]'>
          <h3 className='font-medium text-[13px] text-[var(--text-secondary)]'>{group.label}</h3>
          <div className='grid grid-cols-3 gap-[16px]'>
            {group.templates.map((template) => (
              <TemplateCard key={template.title} template={template} onSelect={onSelect} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface TemplateCardProps {
  template: (typeof TEMPLATES)[number]
  onSelect: (prompt: string) => void
}

function TemplateCard({ template, onSelect }: TemplateCardProps) {
  const Icon = template.icon

  return (
    <button
      type='button'
      onClick={() => onSelect(template.prompt)}
      aria-label={`Select template: ${template.title}`}
      className='group flex cursor-pointer flex-col text-left'
    >
      <div className='overflow-hidden rounded-[8px] border border-[var(--border-1)] transition-colors group-hover:bg-[var(--surface-2)]'>
        <div className='relative h-[120px] w-full overflow-hidden'>
          {template.image ? (
            <Image
              src={template.image}
              alt={template.title}
              fill
              unoptimized
              className='object-cover transition-transform duration-200 group-hover:scale-[1.02]'
            />
          ) : (
            <TemplatePreview modules={template.modules} />
          )}
        </div>
        <div className='flex items-center gap-[6px] border-[var(--border-1)] border-t bg-[var(--white)] px-[12px] py-[8px] transition-colors group-hover:bg-[var(--surface-2)] dark:bg-[var(--surface-4)]'>
          <Icon className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
          <span className='text-[13px] text-[var(--text-body)]'>{template.title}</span>
        </div>
      </div>
    </button>
  )
}
