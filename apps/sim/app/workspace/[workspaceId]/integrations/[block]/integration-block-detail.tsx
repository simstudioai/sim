'use client'

import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { blockTypeToIconMap } from '@/app/(landing)/integrations/data/icon-mapping'
import { TEMPLATES } from '@/app/(landing)/integrations/data/templates'
import type { Integration } from '@/app/(landing)/integrations/data/types'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'

interface IntegrationBlockDetailProps {
  integration: Integration
  workspaceId: string
}

export function IntegrationBlockDetail({ integration, workspaceId }: IntegrationBlockDetailProps) {
  const Icon = blockTypeToIconMap[integration.type]
  const baseType = integration.type.replace(/_v\d+$/, '')

  const matchingTemplates = TEMPLATES.filter(
    (t) =>
      t.integrationBlockTypes.includes(integration.type) ||
      t.integrationBlockTypes.includes(baseType)
  )

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <div className='flex flex-shrink-0 items-center bg-[var(--bg)] px-[16px] pt-[8.5px] pb-[8.5px]'>
        <Link
          href={`/workspace/${workspaceId}/integrations`}
          className='group mx-0.5 inline-flex h-[30px] items-center gap-1.5 rounded-lg px-2 transition-colors hover-hover:bg-[var(--surface-active)]'
        >
          <ArrowLeft className='h-[14px] w-[14px] text-[var(--text-icon)]' />
          <span className='text-[var(--text-body)] text-sm'>Integrations</span>
        </Link>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
        <div className='mx-auto flex max-w-[48rem] flex-col gap-7 pb-3'>
          <div className='flex flex-col gap-3'>
            {Icon ? (
              <IntegrationTile blockType={integration.type} icon={Icon} />
            ) : (
              <div
                className='flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border-1)] text-white'
                style={{ background: integration.bgColor }}
              >
                {integration.name.charAt(0)}
              </div>
            )}
            <div className='flex flex-col gap-1'>
              <h1 className='font-medium text-[var(--text-body)] text-lg'>{integration.name}</h1>
              <p className='max-w-[36rem] text-[var(--text-muted)] text-md'>
                {integration.description}
              </p>
            </div>
          </div>

          {matchingTemplates.length > 0 && (
            <TemplatesSection integration={integration} templates={matchingTemplates} />
          )}
        </div>
      </div>
    </div>
  )
}

interface TemplatesSectionProps {
  integration: Integration
  templates: typeof TEMPLATES
}

function TemplatesSection({ integration, templates }: TemplatesSectionProps) {
  return (
    <section className='flex flex-col gap-2'>
      <div className='px-2'>
        <span className='text-[var(--text-muted)] text-small'>Templates</span>
      </div>
      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
        {templates.map((template) => (
          <button
            type='button'
            key={template.title}
            className='group flex flex-col gap-3 rounded-lg border border-[var(--border-1)] bg-[var(--surface-5)] p-3.5 text-left transition-colors hover-hover:bg-[var(--surface-active)] dark:bg-[var(--surface-4)]'
          >
            <div className='flex items-center gap-1.5'>
              <TemplateIcons
                integration={integration}
                blockTypes={template.integrationBlockTypes}
              />
            </div>
            <div className='flex flex-col gap-1.5'>
              <span className='text-[14px] text-[var(--text-body)] leading-snug'>
                {template.title}
              </span>
              <p className='line-clamp-2 text-[12px] text-[var(--text-muted)] leading-[1.5]'>
                {template.prompt}
              </p>
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}

interface TemplateIconsProps {
  integration: Integration
  blockTypes: string[]
}

function TemplateIcons({ integration, blockTypes }: TemplateIconsProps) {
  const ordered = [integration.type, ...blockTypes.filter((bt) => bt !== integration.type)]

  return (
    <>
      {ordered.map((bt, idx) => {
        const ToolIcon = blockTypeToIconMap[bt]
        return (
          <span key={bt} className='inline-flex items-center gap-1.5'>
            {idx > 0 && (
              <span aria-hidden className='text-[11px] text-[var(--text-muted)]'>
                →
              </span>
            )}
            {ToolIcon ? (
              <IntegrationTile blockType={bt} icon={ToolIcon} />
            ) : (
              <span
                aria-hidden
                className='flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-1)] text-small text-white'
                style={{ background: 'var(--surface-active)' }}
              >
                {bt.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        )
      })}
    </>
  )
}
