import type { ReactNode } from 'react'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import { LogoShell } from '@/app/(landing)/components'

interface PublicFileAuthShellProps {
  title: string
  subtitle: string
  children: ReactNode
}

/**
 * Light, logo-only shell shared by the public file-share auth gates (password,
 * email OTP, SSO), matching the deployed-chat auth screens. Renders no file
 * metadata — the name/provenance are withheld until the visitor authenticates.
 */
export function PublicFileAuthShell({ title, subtitle, children }: PublicFileAuthShellProps) {
  return (
    <LogoShell center footer={<SupportFooter position='absolute' />}>
      <div className='flex w-full max-w-lg flex-col items-center justify-center px-4'>
        <div className='space-y-1 text-center'>
          <h1 className='text-balance text-[40px] text-[var(--text-primary)] leading-[110%] tracking-[-0.02em]'>
            {title}
          </h1>
          <p className='text-[color-mix(in_srgb,var(--text-muted)_60%,transparent)] text-lg leading-[125%] tracking-[0.02em]'>
            {subtitle}
          </p>
        </div>
        <div className='mt-8 w-full max-w-[410px]'>{children}</div>
      </div>
    </LogoShell>
  )
}
