'use client'

import { useCallback, useState } from 'react'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'

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

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!integrationName.trim() || !email.trim()) return

      setStatus('submitting')

      try {
        const res = await fetch('/api/help/integration-request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrationName: integrationName.trim(),
            email: email.trim(),
            useCase: useCase.trim() || undefined,
          }),
        })

        if (!res.ok) throw new Error('Request failed')

        setStatus('success')
        setTimeout(() => setOpen(false), 1500)
      } catch {
        setStatus('error')
      }
    },
    [integrationName, email, useCase]
  )

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

      <Modal open={open} onOpenChange={handleOpenChange}>
        <ModalContent size='sm'>
          <ModalHeader>Request an Integration</ModalHeader>

          {status === 'success' ? (
            <ModalBody>
              <div className='flex flex-col items-center gap-3 py-6 text-center'>
                <div className='flex h-10 w-10 items-center justify-center rounded-full bg-[#33C482]/10'>
                  <svg
                    className='h-5 w-5 text-[var(--brand-accent)]'
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
                  Request submitted — we&apos;ll follow up at{' '}
                  <span className='font-medium'>{email}</span>.
                </p>
              </div>
            </ModalBody>
          ) : (
            <form onSubmit={handleSubmit} className='flex min-h-0 flex-1 flex-col'>
              <ModalBody>
                <div className='space-y-3'>
                  <div className='flex flex-col gap-1'>
                    <Label htmlFor='integration-name'>Integration name</Label>
                    <Input
                      id='integration-name'
                      placeholder='e.g. Stripe, HubSpot, Snowflake'
                      value={integrationName}
                      onChange={(e) => setIntegrationName(e.target.value)}
                      maxLength={200}
                      autoComplete='off'
                      required
                    />
                  </div>

                  <div className='flex flex-col gap-1'>
                    <Label htmlFor='requester-email'>Your email</Label>
                    <Input
                      id='requester-email'
                      type='email'
                      placeholder='you@company.com'
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      autoComplete='email'
                      required
                    />
                  </div>

                  <div className='flex flex-col gap-1'>
                    <Label htmlFor='use-case'>
                      Use case <span className='text-[var(--text-tertiary)]'>(optional)</span>
                    </Label>
                    <Textarea
                      id='use-case'
                      placeholder='What would you automate with this integration?'
                      value={useCase}
                      onChange={(e) => setUseCase(e.target.value)}
                      rows={3}
                      maxLength={2000}
                    />
                  </div>

                  {status === 'error' && (
                    <p className='text-[13px] text-[var(--text-error)]'>
                      Something went wrong. Please try again.
                    </p>
                  )}
                </div>
              </ModalBody>

              <ModalFooter>
                <Button
                  type='button'
                  variant='default'
                  onClick={() => setOpen(false)}
                  disabled={status === 'submitting'}
                >
                  Cancel
                </Button>
                <Button type='submit' variant='primary' disabled={!canSubmit && status !== 'error'}>
                  {status === 'submitting' ? 'Submitting...' : 'Submit request'}
                </Button>
              </ModalFooter>
            </form>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}
