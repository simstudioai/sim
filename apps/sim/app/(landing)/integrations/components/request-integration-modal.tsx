'use client'

import { useCallback, useState } from 'react'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@sim/emcn'
import { requestJson } from '@/lib/api/client/request'
import { integrationRequestContract } from '@/lib/api/contracts/common'

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error'

export function RequestIntegrationModal() {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SubmitStatus>('idle')

  const [integrationName, setIntegrationName] = useState('')
  const [email, setEmail] = useState('')
  const [useCase, setUseCase] = useState('')

  const resetForm = useCallback(() => {
    setIntegrationName('')
    setEmail('')
    setUseCase('')
    setStatus('idle')
  }, [])

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (!nextOpen) resetForm()
    },
    [resetForm]
  )

  const handleSubmit = useCallback(async () => {
    if (!integrationName.trim() || !email.trim()) return

    setStatus('submitting')

    try {
      await requestJson(integrationRequestContract, {
        body: {
          integrationName: integrationName.trim(),
          email: email.trim(),
          useCase: useCase.trim() || undefined,
        },
      })

      setStatus('success')
      setTimeout(() => setOpen(false), 1500)
    } catch {
      setStatus('error')
    }
  }, [integrationName, email, useCase])

  const canSubmit = integrationName.trim() && email.trim() && status === 'idle'

  return (
    <>
      <button
        type='button'
        onClick={() => setOpen(true)}
        className='inline-flex h-[32px] shrink-0 items-center gap-1.5 rounded-[5px] border border-[var(--landing-border-strong)] px-2.5 font-[430] font-season text-[14px] text-[var(--landing-text)] transition-colors hover:bg-[var(--landing-bg-elevated)]'
      >
        Request an integration
      </button>

      <ChipModal open={open} onOpenChange={handleOpenChange} srTitle='Request an Integration'>
        <ChipModalHeader onClose={() => handleOpenChange(false)}>
          Request an Integration
        </ChipModalHeader>

        <ChipModalBody>
          {status === 'success' ? (
            <div className='flex flex-col items-center gap-3 py-6 text-center'>
              <div className='flex size-10 items-center justify-center rounded-full bg-[#33C482]/10'>
                <svg
                  className='size-5 text-[var(--brand-accent)]'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  strokeWidth={2}
                  strokeLinecap='round'
                  strokeLinejoin='round'
                >
                  <polyline points='20 6 9 17 4 12' />
                </svg>
              </div>
              <p className='text-[14px] text-[var(--landing-text)]'>
                Request submitted. We&apos;ll follow up at{' '}
                <span className='font-medium'>{email}</span>.
              </p>
            </div>
          ) : (
            <>
              <ChipModalField
                type='input'
                title='Integration name'
                value={integrationName}
                onChange={(value) => setIntegrationName(value)}
                placeholder='e.g. Stripe, HubSpot, Snowflake'
                maxLength={200}
                autoComplete='off'
                required
              />
              <ChipModalField
                type='email'
                title='Your email'
                value={email}
                onChange={(value) => setEmail(value)}
                placeholder='you@company.com'
                autoComplete='email'
                required
              />
              <ChipModalField
                type='textarea'
                title={
                  <>
                    Use case <span className='text-[var(--text-tertiary)]'>(optional)</span>
                  </>
                }
                value={useCase}
                onChange={(value) => setUseCase(value)}
                placeholder='What would you automate with this integration?'
                rows={3}
                maxLength={2000}
              />
              {status === 'error' && (
                <ChipModalError>Something went wrong. Please try again.</ChipModalError>
              )}
            </>
          )}
        </ChipModalBody>

        {status === 'success' ? (
          <ChipModalFooter
            onCancel={() => handleOpenChange(false)}
            primaryAction={{ label: 'Done', onClick: () => handleOpenChange(false) }}
          />
        ) : (
          <ChipModalFooter
            onCancel={() => setOpen(false)}
            cancelDisabled={status === 'submitting'}
            primaryAction={{
              label: status === 'submitting' ? 'Submitting...' : 'Submit request',
              onClick: handleSubmit,
              disabled: !canSubmit && status !== 'error',
            }}
          />
        )}
      </ChipModal>
    </>
  )
}
