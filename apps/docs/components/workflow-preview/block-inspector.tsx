'use client'

import {
  ChipInput,
  ChipSelect,
  ChipSwitch,
  ChipTag,
  ChipTextarea,
  cn,
  FieldDivider,
  Label,
} from '@sim/emcn'
import { BookOpen, ChevronDown, ChevronRight, Pencil } from 'lucide-react'
import { resolveIcon } from '@/components/workflow-preview/block-icons'

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

interface InspectorConnection {
  name: string
  type?: string
  color?: string
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
  fields: InspectorField[]
  tools?: InspectorTool[]
  connections?: InspectorConnection[]
  /** Render as a borderless panel filling its parent (the lightbox sidebar). */
  embedded?: boolean
}

const NOOP = () => {}

/**
 * Read-only facsimile of one configuration field, composed from the same emcn
 * chip primitives the live editor wraps: `select`→{@link ChipSelect},
 * `input`→{@link ChipInput}, `textarea`/`code`→{@link ChipTextarea} (read-only at
 * full opacity, not greyed out), `toggle`→{@link ChipSwitch}. `slider` has no
 * chip equivalent and stays a minimal app-token bar.
 */
function FieldControl({ field }: { field: InspectorField }) {
  const kind = field.kind ?? 'input'
  const value = field.value ?? ''
  const placeholder = field.placeholder ?? '—'

  if (kind === 'select') {
    return (
      <ChipSelect
        fullWidth
        value={value || undefined}
        onChange={NOOP}
        placeholder={placeholder}
        options={value ? [{ value, label: value }] : []}
      />
    )
  }

  if (kind === 'textarea' || kind === 'code') {
    return (
      <ChipTextarea
        viewOnly
        rows={kind === 'code' ? 4 : 3}
        value={value}
        placeholder={placeholder}
        className={cn('min-h-[60px]', kind === 'code' && 'font-mono')}
      />
    )
  }

  if (kind === 'toggle') {
    const on = field.value === 'on'
    return (
      <ChipSwitch
        value={on ? 'on' : 'off'}
        onChange={NOOP}
        aria-label={field.label}
        options={[
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ]}
      />
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
        <span className='text-[13px] text-[var(--text-primary)]'>{field.value}</span>
      </div>
    )
  }

  return <ChipInput readOnly value={value} placeholder={placeholder} />
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
  fields,
  tools,
  connections,
  embedded = false,
}: BlockInspectorProps) {
  const Icon = resolveIcon(type)
  const hasTools = Boolean(tools && tools.length > 0)

  return (
    <div
      className={cn(
        'bg-[var(--surface-1)]',
        embedded
          ? 'flex h-full w-full flex-col overflow-y-auto'
          : 'not-prose my-6 w-full max-w-[380px] overflow-hidden rounded-xl border border-[var(--border)]'
      )}
    >
      <div className='flex items-center gap-2.5 border-[var(--border)] border-b px-3 py-2.5'>
        <div
          className='flex size-[22px] flex-shrink-0 items-center justify-center rounded-md'
          style={{ background: color }}
        >
          {Icon && <Icon className='size-[13px] text-white' />}
        </div>
        <span className='font-medium text-[14px] text-[var(--text-primary)]'>{name}</span>
        <span className='ml-auto flex items-center gap-2.5 text-[var(--text-muted)]'>
          <Pencil className='size-[13px]' />
          <BookOpen className='size-[13px]' />
        </span>
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
                  const TIcon = resolveIcon(tool.type)
                  return (
                    <ChipTag key={tool.type} variant='gray'>
                      <span
                        className='flex size-[14px] flex-shrink-0 items-center justify-center rounded-[4px]'
                        style={{ background: tool.bgColor }}
                      >
                        {TIcon && <TIcon className='size-[9px] text-white' />}
                      </span>
                      {tool.name}
                    </ChipTag>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {connections && connections.length > 0 && (
        <div className='border-[var(--border)] border-t px-3 py-2.5'>
          <div className='flex items-center gap-1.5 text-[12px] text-[var(--text-muted)]'>
            <ChevronDown className='size-[12px]' />
            Connections
          </div>
          {connections.map((c) => {
            const CIcon = c.type ? resolveIcon(c.type) : null
            return (
              <div key={c.name} className='mt-2 flex items-center gap-2'>
                <div
                  className='flex size-[18px] flex-shrink-0 items-center justify-center rounded-[5px]'
                  style={{ background: c.color ?? 'var(--border-1)' }}
                >
                  {CIcon && <CIcon className='size-[10px] text-white' />}
                </div>
                <span className='text-[13px] text-[var(--text-primary)]'>{c.name}</span>
                <ChevronRight className='size-[12px] text-[var(--text-muted)]' />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
