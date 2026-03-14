import type { ComponentType, SVGProps } from 'react'
import Image from 'next/image'
import { Search, Table } from '@/components/emcn/icons'
import { GmailIcon, GoogleCalendarIcon } from '@/components/icons'
import { MarkdownIcon } from '@/components/icons/document-icons'

interface TemplatePrompt {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  title: string
  prompt: string
  image: string
}

const TEMPLATES: TemplatePrompt[] = [
  {
    icon: Table,
    title: 'Self-populating CRM',
    prompt:
      'Create a self-healing CRM table that keeps track of all my customers by integrating with my existing data sources. Schedule a recurring job every morning to automatically pull updates from all relevant data sources and keep my CRM up to date.',
    image: '/templates/crm-light.png',
  },
  {
    icon: GoogleCalendarIcon,
    title: 'Meeting prep agent',
    prompt:
      'Create an agent that checks my calendar each morning, pulls context on every attendee and topic, and prepares a brief for each meeting so I walk in fully prepared.',
    image: '/templates/meeting-prep-dark.png',
  },
  {
    icon: MarkdownIcon,
    title: 'Resolve todo list',
    prompt:
      'Create a file of all my todos then go one by one and check off every time a todo is done. Look at my calendar and see what I have to do.',
    image: '/templates/todo-list-light.png',
  },
  {
    icon: Search,
    title: 'Research assistant',
    prompt:
      'Build an agent that takes a topic, searches the web for the latest information, summarizes key findings, and compiles them into a clean document I can review.',
    image: '/templates/research-assistant-dark.png',
  },
  {
    icon: GmailIcon,
    title: 'Auto-reply agent',
    prompt: 'Create a Gmail agent that drafts responses to relevant emails automatically.',
    image: '/templates/gmail-agent-dark.png',
  },
  {
    icon: Table,
    title: 'Expense tracker',
    prompt:
      'Create a table that tracks all my expenses by pulling transactions from my connected accounts. Categorize each expense automatically and generate a weekly summary report.',
    image: '/templates/expense-tracker-light.png',
  },
]

interface TemplatePromptsProps {
  onSelect: (prompt: string) => void
}

export function TemplatePrompts({ onSelect }: TemplatePromptsProps) {
  return (
    <div className='grid grid-cols-3 gap-[16px]'>
      {TEMPLATES.map((template) => {
        const Icon = template.icon
        return (
          <button
            key={template.title}
            type='button'
            onClick={() => onSelect(template.prompt)}
            className='group flex cursor-pointer flex-col text-left'
          >
            <div className='overflow-hidden rounded-[10px] border border-[var(--border-1)]'>
              <div className='relative h-[120px] w-full overflow-hidden'>
                <Image
                  src={template.image}
                  alt={template.title}
                  fill
                  unoptimized
                  className='object-cover transition-transform duration-300 group-hover:scale-105'
                />
              </div>
              <div className='flex items-center gap-[6px] border-[var(--border-1)] border-t bg-[var(--white)] px-[10px] py-[6px] dark:bg-[var(--surface-4)]'>
                <Icon className='h-[14px] w-[14px] shrink-0 text-[var(--text-icon)]' />
                <span className='font-base text-[14px] text-[var(--text-body)]'>
                  {template.title}
                </span>
              </div>
            </div>
          </button>
        )
      })}
    </div>
  )
}
