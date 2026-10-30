import { useId, useRef, useState } from 'react'
import {
  Chip,
  cn,
  overflowFadeSizeClass,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { ChevronDown, ChevronRight } from '@sim/emcn/icons'
import {
  assistantActionFieldPresentation,
  assistantActionPresentation,
} from '@/components/assistant-actions/presentation'
import type { AssistantActionsResponse } from '@/lib/api/contracts/assistant-actions'

type ReviewField = AssistantActionsResponse['actions'][number]['fields'][number]

interface ActionPreviewProps {
  action: Pick<AssistantActionsResponse['actions'][number], 'toolId' | 'name' | 'fields'>
  account?: string
  full?: boolean
}

/** Readable content first; supplied secondary parameters remain inspectable. */
export function ActionPreview({ action, account, full = false }: ActionPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const { targets, primary, details } = assistantActionPresentation(action)
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      {(account || targets.length > 0) && (
        <div className='flex flex-col gap-1'>
          {account && (
            <dl className='grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-baseline gap-x-3 text-small'>
              <dt className='text-[var(--text-muted)] text-caption'>Account</dt>
              <dd className='min-w-0 break-all text-[var(--text-body)]'>{account}</dd>
            </dl>
          )}
          {targets.map((field) => (
            <PreviewField key={field.name} field={field} compact />
          ))}
        </div>
      )}
      {primary.length > 0 && (
        <div className='flex min-w-0 flex-col gap-2 border-[var(--border)] border-t pt-2'>
          {primary.map((field, index) => (
            <PreviewField
              key={field.name}
              field={field}
              compact={field.format === 'text'}
              prominent={index === 0 && field.format === 'text'}
            />
          ))}
        </div>
      )}
      {details.length > 0 && (
        <>
          {!full && (
            <div>
              <Chip
                aria-expanded={expanded}
                aria-controls={detailsId}
                leftIcon={expanded ? ChevronDown : ChevronRight}
                onClick={() => setExpanded(!expanded)}
              >
                Details
              </Chip>
            </div>
          )}
          {(expanded || full) && (
            <div id={detailsId} className='flex flex-col gap-2'>
              {details.map((field) => (
                <PreviewField key={field.name} field={field} compact />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

interface PreviewFieldProps {
  field: ReviewField
  compact?: boolean
  prominent?: boolean
}

function PreviewField({ field, compact = false, prominent = false }: PreviewFieldProps) {
  const scroll = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scroll)
  const display = assistantActionFieldPresentation(field)
  let value = display.value
  if (field.format === 'json') {
    try {
      value = JSON.stringify(JSON.parse(value), null, 2)
    } catch {}
  }
  return (
    <dl
      className={cn(
        'min-w-0',
        compact && field.format === 'text'
          ? 'grid grid-cols-[minmax(0,6rem)_minmax(0,1fr)] items-baseline gap-x-3'
          : 'flex flex-col gap-1'
      )}
    >
      <dt className='break-words text-[var(--text-muted)] text-caption'>{display.label}</dt>
      <dd className='min-w-0'>
        <div
          ref={scroll}
          tabIndex={edges.top || edges.bottom ? 0 : undefined}
          role='region'
          aria-label={`${display.label} preview`}
          className={cn(
            'max-h-32 overflow-auto whitespace-pre-wrap break-words text-[var(--text-body)] text-small',
            scrollFadeClass,
            overflowFadeSizeClass,
            prominent && 'font-medium'
          )}
          {...scrollFadeAttributes(edges)}
        >
          <span className='block'>{value}</span>
        </div>
      </dd>
    </dl>
  )
}
