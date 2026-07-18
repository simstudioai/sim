'use client'

import { useState } from 'react'
import { Button, Checkbox, Combobox, Input, Label, Loader, Textarea } from '@sim/emcn'
import { InterfaceResultPresenter } from '@/components/interfaces/result-presenter'
import { SafeMarkdown } from '@/components/interfaces/safe-markdown'
import type { PublicInterfaceDto } from '@/lib/interfaces'

interface InterfaceRendererProps {
  dto: PublicInterfaceDto
  onSubmit: (actionId: string, values: Record<string, unknown>) => Promise<void>
  isSubmitting?: boolean
  result?: { success: boolean; output?: unknown; error?: string } | null
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
  const hasControls = dto.sections.some((section) => section.controls.length > 0)

  return (
    <div
      className='relative w-full overflow-hidden'
      style={
        {
          '--interface-primary': primaryColor,
        } as React.CSSProperties
      }
    >
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0'
        style={{
          background: `
            radial-gradient(120% 80% at 50% -10%, color-mix(in srgb, ${primaryColor} 22%, transparent), transparent 55%),
            linear-gradient(180deg, color-mix(in srgb, ${primaryColor} 8%, #fafafa) 0%, #f7f7f5 45%, #f4f3f0 100%)
          `,
        }}
      />

      <div className='relative mx-auto w-full max-w-md px-5 py-12 sm:py-16'>
        <header className='mb-8 space-y-3 text-center sm:mb-10 sm:text-left'>
          <h1 className='font-semibold text-3xl text-[var(--text-primary)] tracking-tight sm:text-[2rem]'>
            {dto.title}
          </h1>
          {dto.description ? (
            <p className='mx-auto max-w-prose text-[var(--text-secondary)] text-base leading-relaxed sm:mx-0'>
              {dto.description}
            </p>
          ) : null}
        </header>

        <div className='rounded-2xl border border-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] bg-[color-mix(in_srgb,#fff_88%,transparent)] p-5 shadow-[0_1px_0_rgba(0,0,0,0.03)] backdrop-blur-sm sm:p-6'>
          {hasControls ? (
            <div className='space-y-7'>
              {dto.sections.map((section) => (
                <section key={section.id} className='space-y-4'>
                  {section.title ? (
                    <h2 className='font-medium text-[var(--text-primary)] text-sm'>
                      {section.title}
                    </h2>
                  ) : null}
                  {section.controls.map((control) => {
                    if (control.type === 'markdown') {
                      return <SafeMarkdown key={control.id} content={control.content} />
                    }

                    if (control.type === 'checkbox') {
                      return (
                        <div key={control.id} className='flex items-center gap-2.5'>
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
                              typeof values[control.id] === 'number'
                                ? String(values[control.id])
                                : ''
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
          ) : null}

          <div className={hasControls ? 'mt-7 space-y-3' : 'space-y-3'}>
            {dto.actions.map((action) => (
              <Button
                key={action.id}
                disabled={isSubmitting}
                variant={action.variant === 'secondary' ? 'outline' : 'default'}
                className='w-full sm:w-full'
                style={
                  action.variant !== 'secondary'
                    ? {
                        backgroundColor: primaryColor,
                        borderColor: primaryColor,
                        color: '#fff',
                      }
                    : undefined
                }
                onClick={() => onSubmit(action.id, buildSubmitValues())}
              >
                {isSubmitting ? 'Running…' : action.label}
              </Button>
            ))}

            {isSubmitting ? (
              <div className='flex items-center justify-center gap-2 text-[var(--text-secondary)] text-sm'>
                <Loader className='h-4 w-4' animate />
                <span>Running workflow…</span>
              </div>
            ) : null}
          </div>
        </div>

        {result?.success ? (
          <div className='mt-5 rounded-2xl border border-[color-mix(in_srgb,var(--text-primary)_8%,transparent)] bg-[color-mix(in_srgb,#fff_92%,transparent)] p-5 shadow-[0_1px_0_rgba(0,0,0,0.03)] backdrop-blur-sm'>
            <p className='mb-3 font-medium text-[var(--text-tertiary)] text-xs uppercase tracking-wide'>
              Result
            </p>
            <InterfaceResultPresenter
              output={result.output}
              successMessage={dto.messages?.success}
            />
          </div>
        ) : null}

        {result && !result.success ? (
          <div className='mt-5 rounded-2xl border border-[color-mix(in_srgb,#b91c1c_25%,transparent)] bg-[color-mix(in_srgb,#fef2f2_90%,transparent)] p-5 text-[#991b1b] text-sm'>
            {result.error || dto.messages?.error || 'Something went wrong'}
          </div>
        ) : null}
      </div>
    </div>
  )
}
