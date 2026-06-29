'use client'

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

const CONTROL =
  'flex w-full items-center justify-between gap-2 rounded-[10px] bg-[var(--surface-5)] px-3 py-2.5 text-[13px]'

function FieldControl({ field }: { field: InspectorField }) {
  const kind = field.kind ?? 'input'
  const hasValue = field.value !== undefined && field.value !== ''
  const textColor = hasValue ? 'var(--text-primary)' : 'var(--text-muted)'
  const text = hasValue ? field.value : (field.placeholder ?? '—')

  if (kind === 'textarea' || kind === 'code') {
    return (
      <div
        className='w-full rounded-[10px] bg-[var(--surface-5)] px-3 py-2.5 text-[13px] leading-[1.55]'
        style={{
          color: textColor,
          fontFamily: kind === 'code' ? 'var(--font-mono, monospace)' : undefined,
        }}
      >
        {text}
      </div>
    )
  }

  if (kind === 'toggle') {
    const on = field.value === 'on'
    return (
      <div className='flex items-center gap-2'>
        <div
          className='flex h-[18px] w-[32px] items-center rounded-full px-[2px] transition-colors'
          style={{ background: on ? 'var(--brand-accent)' : 'var(--border-1)' }}
        >
          <div
            className='size-[14px] rounded-full bg-white'
            style={{ marginLeft: on ? 'auto' : 0 }}
          />
        </div>
        <span className='text-[12px] text-[var(--text-muted)]'>{on ? 'On' : 'Off'}</span>
      </div>
    )
  }

  if (kind === 'slider') {
    const percent = field.percent ?? 50
    return (
      <div className='flex w-full items-center gap-3'>
        <div className='relative h-[4px] flex-1 rounded-full bg-[var(--border-1)]'>
          <div
            className='absolute inset-y-0 left-0 rounded-full bg-[var(--brand-accent)]'
            style={{ width: `${percent}%` }}
          />
          <div
            className='-translate-y-1/2 absolute top-1/2 size-[12px] rounded-full bg-white'
            style={{ left: `calc(${percent}% - 6px)` }}
          />
        </div>
        <span className='text-[13px] text-[var(--text-primary)]'>{field.value}</span>
      </div>
    )
  }

  return (
    <div className={CONTROL}>
      <span className='truncate' style={{ color: textColor }}>
        {text}
      </span>
      {kind === 'select' && (
        <ChevronDown className='size-[14px] flex-shrink-0 text-[var(--text-muted)]' />
      )}
    </div>
  )
}

/**
 * A read-only facsimile of the editor's right-hand block inspector: the block
 * header, its configuration fields as static controls, and its connections.
 * Hand-authored per usage, like {@link WorkflowPreview} examples.
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

  return (
    <div
      className={
        embedded
          ? 'flex h-full w-full flex-col overflow-y-auto bg-[var(--surface-1)]'
          : 'not-prose my-6 w-full max-w-[380px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-1)]'
      }
    >
      <div className='flex items-center gap-2.5 border-[var(--border)] border-b px-3 py-2.5'>
        <div
          className='flex size-[22px] flex-shrink-0 items-center justify-center rounded-[6px]'
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

      <div className='flex flex-col px-3 py-1'>
        {fields.map((field, i) => (
          <div
            key={field.label}
            className='flex flex-col gap-2 py-3'
            style={i > 0 ? { borderTop: '1px dashed var(--divider)' } : undefined}
          >
            <span className='font-medium text-[13px] text-[var(--text-primary)]'>
              {field.label}
              {field.required && <span className='ml-1 text-[var(--text-muted)]'>*</span>}
            </span>
            <FieldControl field={field} />
          </div>
        ))}

        {tools && tools.length > 0 && (
          <div
            className='flex flex-col gap-2 py-3'
            style={fields.length > 0 ? { borderTop: '1px dashed var(--divider)' } : undefined}
          >
            <span className='font-medium text-[13px] text-[var(--text-primary)]'>Tools</span>
            <div className='flex flex-wrap gap-[6px]'>
              {tools.map((tool) => {
                const TIcon = resolveIcon(tool.type)
                return (
                  <div
                    key={tool.type}
                    className='flex items-center gap-[5px] rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[7px] py-[4px]'
                  >
                    <div
                      className='flex size-[14px] flex-shrink-0 items-center justify-center rounded-[4px]'
                      style={{ background: tool.bgColor }}
                    >
                      {TIcon && <TIcon className='size-[9px] text-white' />}
                    </div>
                    <span className='text-[12px] text-[var(--text-primary)]'>{tool.name}</span>
                  </div>
                )
              })}
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
