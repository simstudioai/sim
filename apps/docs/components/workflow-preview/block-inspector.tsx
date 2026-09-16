'use client'

import {
  ChipTag,
  chipFieldSurfaceClass,
  chipFieldTextClass,
  cn,
  FieldDivider,
  Label,
} from '@sim/emcn'
import { formatDisplayText } from '@sim/workflow-renderer/formatted-text'
import { DocsBlockTile } from '@/components/workflow-preview/docs-block-tile'

type FieldKind = 'select' | 'input' | 'textarea' | 'code' | 'slider' | 'toggle'

interface InspectorField {
  label: string
  required?: boolean
  kind?: FieldKind
  /** Shown inside the control. For 'toggle', "on"/"off". For 'slider', the number. */
  value?: string
  /** Muted placeholder when there's no value. */
  placeholder?: string
  /** Slider fill, 0–100. */
  percent?: number
}

interface InspectorTool {
  type: string
  name: string
  bgColor: string
}

interface BlockInspectorProps {
  /** Block name in the header, e.g. "Agent 1". */
  name: string
  /** Block type, for the header icon. */
  type?: string
  color?: string
  isIntegration?: boolean
  triggerMode?: boolean
  fields: InspectorField[]
  tools?: InspectorTool[]
  /** Render as a borderless panel filling its parent (the lightbox sidebar). */
  embedded?: boolean
}

/** Displays a configuration value using the shared chip field surface. */
function FieldControl({ field }: { field: InspectorField }) {
  const kind = field.kind ?? 'input'
  const value = field.value ?? ''
  const placeholder = field.placeholder ?? '—'

  if (kind === 'select' || kind === 'toggle') {
    const content = kind === 'toggle' ? (value === 'on' ? 'On' : 'Off') : value || placeholder
    return (
      <div className={cn(chipFieldSurfaceClass, 'flex min-h-[30px] items-center px-2 py-1')}>
        <span className={chipFieldTextClass}>
          {formatDisplayText(content, { highlightAll: true })}
        </span>
      </div>
    )
  }

  if (kind === 'slider') {
    const percent = field.percent ?? 50
    return (
      <div className='flex w-full items-center gap-3'>
        <div className='relative h-[4px] flex-1 rounded-full bg-[var(--surface-5)]'>
          <div
            className='absolute inset-y-0 left-0 rounded-full bg-[var(--brand-secondary)]'
            style={{ width: `${percent}%` }}
          />
          <div
            className='-translate-y-1/2 absolute top-1/2 size-[12px] rounded-full border border-[var(--border-1)] bg-white'
            style={{ left: `calc(${percent}% - 6px)` }}
          />
        </div>
        <span className='text-[var(--text-primary)] text-small'>{field.value}</span>
      </div>
    )
  }

  const content = value ? (
    formatDisplayText(value, { highlightAll: true })
  ) : (
    <span className='text-[var(--text-muted)]'>{placeholder}</span>
  )
  if (kind === 'textarea' || kind === 'code') {
    return (
      <div
        className={cn(
          chipFieldSurfaceClass,
          chipFieldTextClass,
          'min-h-[60px] whitespace-pre-wrap break-words px-2 py-1.5',
          kind === 'code' && 'font-mono'
        )}
      >
        {content}
      </div>
    )
  }
  return (
    <div className={cn(chipFieldSurfaceClass, 'flex h-[30px] items-center px-2')}>
      <span className={cn(chipFieldTextClass, 'min-w-0 truncate')}>{content}</span>
    </div>
  )
}

function InspectorFieldRow({ field }: { field: InspectorField }) {
  return (
    <div className='flex flex-col gap-2.5'>
      <Label className='pl-0.5'>
        {field.label}
        {field.required && <span className='ml-0.5'>*</span>}
      </Label>
      <FieldControl field={field} />
    </div>
  )
}

/**
 * A read-only facsimile of the editor's right-hand block inspector: the block
 * header, its configuration fields as static chip controls, and its
 * connections. Hand-authored per usage, like {@link WorkflowPreview} examples.
 */
export function BlockInspector({
  name,
  type = 'agent',
  color = '#33C482',
  isIntegration,
  triggerMode,
  fields,
  tools,
  embedded = false,
}: BlockInspectorProps) {
  const hasTools = Boolean(tools && tools.length > 0)

  return (
    <div
      className={cn(
        'bg-[var(--surface-1)] [--brand-secondary:#0067a3] dark:[--brand-secondary:#33b4ff]',
        embedded
          ? 'flex min-h-0 w-full flex-1 flex-col overflow-y-auto'
          : 'not-prose my-6 w-full max-w-[380px] overflow-hidden rounded-xl border border-[var(--border)]'
      )}
    >
      <div className='flex items-center justify-between border-[var(--border)] border-b bg-[var(--surface-4)] px-3 py-1.5'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <DocsBlockTile
            type={type}
            color={color}
            isIntegration={isIntegration}
            triggerMode={triggerMode}
          />
          <span className='truncate text-[var(--text-primary)] text-sm'>{name}</span>
        </div>
      </div>

      <div className='flex flex-col px-3 py-3'>
        {fields.map((field, i) => (
          <div key={field.label}>
            {i > 0 && <FieldDivider />}
            <InspectorFieldRow field={field} />
          </div>
        ))}

        {hasTools && (
          <div>
            {fields.length > 0 && <FieldDivider />}
            <div className='flex flex-col gap-2.5'>
              <Label className='pl-0.5'>Tools</Label>
              <div className='flex flex-wrap gap-[6px]'>
                {tools?.map((tool) => {
                  return (
                    <ChipTag key={tool.type} variant='gray'>
                      <DocsBlockTile
                        type={tool.type}
                        color={tool.bgColor}
                        isIntegration
                        size='md'
                      />
                      {tool.name}
                    </ChipTag>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
