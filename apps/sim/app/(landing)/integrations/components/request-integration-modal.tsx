'use client'

import { useCallback, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalField,
  ChipModalFooter,
  ChipModalHeader,
} from '@/components/emcn'
import { requestJson } from '@/lib/api/client/request'
import { integrationRequestContract } from '@/lib/api/contracts/common'

type SubmitStatus = 'idle' | 'submitting' | 'success' | 'error'

export function RequestIntegrationModal() {
  const tI18n = useTranslations('auto')
  const t = useTranslations('auto')
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
        {t('request_an_integration')}
      </button>

      <ChipModal
        open={open}
        onOpenChange={handleOpenChange}
        srTitle={tI18n('request_an_integration')}
      >
        <ChipModalHeader onClose={() => handleOpenChange(false)}>
          {t('request_an_integration_2')}
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
                {t('request_submitted_we_apos_ll_follow')}{' '}
                <span className='font-medium'>{email}</span>.
              </p>
            </div>
          ) : (
            <>
              <ChipModalField
                type='input'
                title={t('integration_name')}
                value={integrationName}
                onChange={(value) => setIntegrationName(value)}
                placeholder={t('e_g_stripe_hubspot_snowflake')}
                maxLength={200}
                autoComplete='off'
                required
              />
              <ChipModalField
                type='email'
                title={t('your_email')}
                value={email}
                onChange={(value) => setEmail(value)}
                placeholder={t('you_company_com')}
                autoComplete='email'
                required
              />
              <ChipModalField
                type='textarea'
                title={
                  <>
                    {t('use_case')}{' '}
                    <span className='text-[var(--text-tertiary)]'>{t('optional')}</span>
                  </>
                }
                value={useCase}
                onChange={(value) => setUseCase(value)}
                placeholder={t('what_would_you_automate_with_this')}
                rows={3}
                maxLength={2000}
              />
              {status === 'error' && (
                <ChipModalError>{t('something_went_wrong_please_try_again')}</ChipModalError>
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
