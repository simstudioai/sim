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
import { assistantActionPresentation } from '@/components/assistant-actions/presentation'
import type { AssistantActionsResponse } from '@/lib/api/contracts/assistant-actions'

type ReviewField = AssistantActionsResponse['actions'][number]['fields'][number]

interface ActionPreviewProps {
  action: Pick<AssistantActionsResponse['actions'][number], 'toolId' | 'name' | 'fields'>
  full?: boolean
}

/** Readable content first; supplied secondary parameters remain inspectable. */
export function ActionPreview({ action, full = false }: ActionPreviewProps) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const { targets, primary, details } = assistantActionPresentation(action)
  return (
    <div className='flex min-w-0 flex-col gap-2'>
      {targets.length > 0 && (
        <dl className='flex flex-wrap gap-x-4 gap-y-1'>
          {targets.map((field) => (
            <div key={field.name} className='flex min-w-0 flex-wrap gap-x-1.5 text-small'>
              <dt className='text-[var(--text-muted)]'>{field.label}</dt>
              <dd className='whitespace-pre-wrap break-all text-[var(--text-body)]'>
                {field.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {primary.map((field, index) => (
        <PreviewField
          key={field.name}
          field={field}
          primary
          prominent={index === 0 && field.format === 'text'}
        />
      ))}
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
                <PreviewField key={field.name} field={field} />
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
  primary?: boolean
  prominent?: boolean
}

function PreviewField({ field, primary = false, prominent = false }: PreviewFieldProps) {
  const scroll = useRef<HTMLDivElement>(null)
  const edges = useScrollEdges(scroll)
  let value = field.value
  if (field.format === 'json') {
    try {
      value = JSON.stringify(JSON.parse(value), null, 2)
    } catch {}
  }
  return (
    <dl className='flex min-w-0 flex-col gap-1'>
      {(!primary || field.format === 'json') && (
        <dt className='text-[var(--text-muted)] text-caption'>{field.label}</dt>
      )}
      <dd>
        <div
          ref={scroll}
          tabIndex={edges.top || edges.bottom ? 0 : undefined}
          role='region'
          aria-label={`${field.label} preview`}
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
