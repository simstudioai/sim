import type { ReactNode } from 'react'
import { PublicAuthHeader } from '@/components/auth/public-auth-header'
import { SupportFooter } from '@/app/(auth)/components/support-footer'
import { LogoShell } from '@/app/(landing)/components/logo-shell'

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
    <LogoShell center footer={<SupportFooter position='static' />}>
      <div className='flex w-full max-w-lg flex-col items-center justify-center px-4'>
        <PublicAuthHeader title={title} description={subtitle} />
        <div className='mt-8 w-full max-w-[410px]'>{children}</div>
      </div>
    </LogoShell>
  )
}
