'use client'

import { useState } from 'react'
import { Button, Checkbox, Combobox, Input, Label, Textarea } from '@sim/emcn'
import { SafeMarkdown } from '@/components/interfaces/safe-markdown'
import type { PublicInterfaceDto } from '@/lib/interfaces'

interface InterfaceRendererProps {
  dto: PublicInterfaceDto
  onSubmit: (actionId: string, values: Record<string, unknown>) => Promise<void>
  isSubmitting?: boolean
  result?: { success: boolean; output?: unknown; error?: string } | null
}

function formatOutput(output: unknown): string {
  if (typeof output === 'string') return output
  try {
    return JSON.stringify(output, null, 2)
  } catch {
    return String(output)
  }
}

/**
 * Schema-driven interface renderer. Consumes the public DTO only.
 * Untouched optional controls are omitted from submitted values.
 */
export function InterfaceRenderer({
  dto,
  onSubmit,
  isSubmitting = false,
  result = null,
}: InterfaceRendererProps) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  const setValue = (id: string, value: unknown) => {
    setTouched((prev) => ({ ...prev, [id]: true }))
    setValues((prev) => ({ ...prev, [id]: value }))
  }

  const buildSubmitValues = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {}
    for (const section of dto.sections) {
      for (const control of section.controls) {
        if (control.type === 'markdown') continue
        if (!touched[control.id] && !control.required) continue
        if (control.id in values) {
          out[control.id] = values[control.id]
        } else if (control.type === 'checkbox' && control.required) {
          out[control.id] = false
        }
      }
    }
    return out
  }

  const primaryColor = dto.primaryColor || 'var(--brand-hover)'

  return (
    <div
      className='mx-auto w-full max-w-lg px-4 py-10'
      style={
        {
          '--interface-primary': primaryColor,
        } as React.CSSProperties
      }
    >
      <div className='mb-8 space-y-2'>
        <h1 className='font-semibold text-2xl text-[var(--text-primary)]'>{dto.title}</h1>
        {dto.description ? (
          <p className='text-[var(--text-secondary)] text-sm'>{dto.description}</p>
        ) : null}
      </div>

      <div className='space-y-8'>
        {dto.sections.map((section) => (
          <section key={section.id} className='space-y-4'>
            {section.title ? (
              <h2 className='font-medium text-[var(--text-primary)] text-sm'>{section.title}</h2>
            ) : null}
            {section.controls.map((control) => {
              if (control.type === 'markdown') {
                return <SafeMarkdown key={control.id} content={control.content} />
              }

              if (control.type === 'checkbox') {
                return (
                  <div key={control.id} className='flex items-center gap-2'>
                    <Checkbox
                      id={control.id}
                      checked={Boolean(values[control.id])}
                      onCheckedChange={(checked) => setValue(control.id, checked === true)}
                      disabled={isSubmitting}
                    />
                    <Label htmlFor={control.id}>{control.label}</Label>
                  </div>
                )
              }

              if (control.type === 'select') {
                return (
                  <div key={control.id} className='space-y-1.5'>
                    <Label htmlFor={control.id}>
                      {control.label}
                      {control.required ? ' *' : ''}
                    </Label>
                    <Combobox
                      options={control.options.map((option) => ({
                        label: option.label,
                        value: option.value,
                      }))}
                      value={(values[control.id] as string) || ''}
                      onChange={(value) => setValue(control.id, value)}
                      placeholder='Select…'
                      disabled={isSubmitting}
                    />
                  </div>
                )
              }

              if (control.type === 'textarea') {
                return (
                  <div key={control.id} className='space-y-1.5'>
                    <Label htmlFor={control.id}>
                      {control.label}
                      {control.required ? ' *' : ''}
                    </Label>
                    <Textarea
                      id={control.id}
                      placeholder={control.placeholder}
                      value={(values[control.id] as string) || ''}
                      onChange={(e) => setValue(control.id, e.target.value)}
                      disabled={isSubmitting}
                    />
                  </div>
                )
              }

              if (control.type === 'number') {
                return (
                  <div key={control.id} className='space-y-1.5'>
                    <Label htmlFor={control.id}>
                      {control.label}
                      {control.required ? ' *' : ''}
                    </Label>
                    <Input
                      id={control.id}
                      type='number'
                      value={
                        typeof values[control.id] === 'number' ? String(values[control.id]) : ''
                      }
                      onChange={(e) => {
                        const raw = e.target.value
                        if (raw === '') {
                          setTouched((prev) => ({ ...prev, [control.id]: true }))
                          setValues((prev) => {
                            const next = { ...prev }
                            delete next[control.id]
                            return next
                          })
                          return
                        }
                        setValue(control.id, Number(raw))
                      }}
                      disabled={isSubmitting}
                    />
                  </div>
                )
              }

              return (
                <div key={control.id} className='space-y-1.5'>
                  <Label htmlFor={control.id}>
                    {control.label}
                    {control.required ? ' *' : ''}
                  </Label>
                  <Input
                    id={control.id}
                    type='text'
                    placeholder={control.placeholder}
                    value={(values[control.id] as string) || ''}
                    onChange={(e) => setValue(control.id, e.target.value)}
                    disabled={isSubmitting}
                  />
                </div>
              )
            })}
          </section>
        ))}
      </div>

      <div className='mt-8 flex flex-wrap gap-3'>
        {dto.actions.map((action) => (
          <Button
            key={action.id}
            disabled={isSubmitting}
            variant={action.variant === 'secondary' ? 'outline' : 'default'}
            style={
              action.variant !== 'secondary'
                ? { backgroundColor: primaryColor, borderColor: primaryColor }
                : undefined
            }
            onClick={() => onSubmit(action.id, buildSubmitValues())}
          >
            {isSubmitting ? 'Running…' : action.label}
          </Button>
        ))}
      </div>

      {result?.success ? (
        <div className='mt-6 rounded-md border border-[var(--border)] p-4'>
          {result.output !== undefined ? (
            typeof result.output === 'string' ? (
              <SafeMarkdown content={result.output} />
            ) : (
              <pre className='overflow-x-auto whitespace-pre-wrap font-mono text-xs'>
                {formatOutput(result.output)}
              </pre>
            )
          ) : (
            <p className='text-sm'>{dto.messages?.success || 'Done!'}</p>
          )}
        </div>
      ) : null}

      {result && !result.success ? (
        <div className='mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-red-800 text-sm'>
          {result.error || dto.messages?.error || 'Something went wrong'}
        </div>
      ) : null}
    </div>
  )
}
