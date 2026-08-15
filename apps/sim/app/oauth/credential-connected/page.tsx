import { ChipLink } from '@sim/emcn'
import { CircleAlert, CircleCheck } from '@sim/emcn/icons'
import type { Metadata } from 'next'
import { LogoShell } from '@/app/(landing)/components'

export const metadata: Metadata = {
  title: 'Credential connected',
  robots: { index: false, follow: false },
}

interface CredentialConnectedPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function CredentialConnectedPage({
  searchParams,
}: CredentialConnectedPageProps) {
  const params = await searchParams
  const result = typeof params.result === 'string' ? params.result : undefined
  const error = Array.isArray(params.error) ? params.error[0] : params.error
  const connected = result === 'connected' && !error

  return (
    <LogoShell center>
      <div className='flex w-full max-w-[410px] flex-col items-center gap-3 text-center'>
        <div
          className='mb-2 flex size-12 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] shadow-card'
          aria-hidden
        >
          {connected ? (
            <CircleCheck className='size-[20px] text-[var(--text-success)]' />
          ) : (
            <CircleAlert className='size-[20px] text-[var(--text-error)]' />
          )}
        </div>
        <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
          {connected ? 'Credential connected' : 'Connection failed'}
        </h1>
        <p className='text-pretty text-[var(--text-muted)] text-lg'>
          {connected
            ? 'The credential is ready to use. You can close this tab and return to the app that started the connection.'
            : 'The credential could not be connected. Return to the app that started the connection and try again.'}
        </p>
        <ChipLink variant='primary' href='/workspace' className='mt-3'>
          Open Sim
        </ChipLink>
      </div>
    </LogoShell>
  )
}
