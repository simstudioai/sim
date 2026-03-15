'use client'

import { useState } from 'react'
import Image from 'next/image'
import { ChevronDown } from '@/components/emcn/icons'
import type { Category, ModuleTag } from './consts'
import { CATEGORY_META, MODULE_META, TEMPLATES } from './consts'

const FEATURED_TEMPLATES = TEMPLATES.filter((t) => t.featured)
const EXTRA_TEMPLATES = TEMPLATES.filter((t) => !t.featured)

/** Group non-featured templates by category, preserving category order. */
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

function ModulePills({ modules }: { modules: ModuleTag[] }) {
  return (
    <div className='flex flex-wrap gap-[4px]'>
      {modules.map((mod) => (
        <span
          key={mod}
          className='rounded-full bg-[var(--surface-3)] px-[6px] py-[1px] text-[11px] text-[var(--text-secondary)]'
        >
          {MODULE_META[mod].label}
        </span>
      ))}
    </div>
  )
}

interface TemplatePromptsProps {
  onSelect: (prompt: string) => void
}

export function TemplatePrompts({ onSelect }: TemplatePromptsProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className='flex flex-col gap-[24px]'>
      {/* Featured grid */}
      <div className='grid grid-cols-3 gap-[16px]'>
        {FEATURED_TEMPLATES.map((template) => (
          <TemplateCard key={template.title} template={template} onSelect={onSelect} />
        ))}
      </div>

      {/* Expand / collapse */}
      <button
        type='button'
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className='flex items-center justify-center gap-[6px] text-[13px] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-body)]'
      >
        {expanded ? (
          <>
            Show less <ChevronDown className='h-[14px] w-[14px] rotate-180' />
          </>
        ) : (
          <>
            More examples <ChevronDown className='h-[14px] w-[14px]' />
          </>
        )}
      </button>

      {/* Categorized extras */}
      {expanded && (
        <div className='flex flex-col gap-[32px]'>
          {GROUPED_EXTRAS.map((group) => (
            <div key={group.category} className='flex flex-col gap-[12px]'>
              <h3 className='font-medium text-[13px] text-[var(--text-secondary)]'>
                {group.label}
              </h3>
              <div className='grid grid-cols-3 gap-[16px]'>
                {group.templates.map((template) => (
                  <TemplateCard key={template.title} template={template} onSelect={onSelect} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
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
      <div className='overflow-hidden rounded-[10px] border border-[var(--border-1)]'>
        <div className='relative h-[120px] w-full overflow-hidden'>
          {template.image ? (
            <Image
              src={template.image}
              alt={template.title}
              fill
              unoptimized
              className='object-cover transition-transform duration-300 group-hover:scale-105'
            />
          ) : (
            <div className='flex h-full w-full items-center justify-center bg-[var(--surface-3)] transition-colors group-hover:bg-[var(--surface-4)]'>
              <Icon className='h-[32px] w-[32px] text-[var(--text-icon)] opacity-40' />
            </div>
          )}
        </div>
        <div className='flex flex-col gap-[4px] border-[var(--border-1)] border-t bg-[var(--white)] px-[10px] py-[6px] dark:bg-[var(--surface-4)]'>
          <div className='flex items-center gap-[6px]'>
            <Icon className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
            <span className='font-base text-[14px] text-[var(--text-body)]'>{template.title}</span>
          </div>
          <ModulePills modules={template.modules} />
        </div>
      </div>
    </button>
  )
}
