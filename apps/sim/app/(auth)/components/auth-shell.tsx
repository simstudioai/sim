import { type ReactNode, Suspense } from 'react'
import { AuthRoot, AuthShellView, AuthWordmark } from '@sim/auth-ui'
import { DesktopTitleBarController } from '@/app/_shell/desktop-title-bar'
import { AuthNavigation } from '@/app/(auth)/components/auth-navigation'
import { SupportFooter } from '@/app/(auth)/components/support-footer'

interface AuthShellProps {
  children: ReactNode
  footer?: ReactNode
  registrationDisabled?: boolean
}

/** Application adapter for identity and native chrome; all visual rules belong to Auth. */
export function AuthShell({ children, footer, registrationDisabled = false }: AuthShellProps) {
  return (
    <AuthRoot>
      <AuthShellView
        homeHref='/'
        logo={<AuthWordmark />}
        navigation={
          <Suspense>
            <AuthNavigation registrationDisabled={registrationDisabled} />
          </Suspense>
        }
        footer={footer ?? <SupportFooter />}
        titlebar={
          <>
            <DesktopTitleBarController />
            <div data-auth-titlebar='' aria-hidden='true' />
          </>
        }
      >
        {children}
      </AuthShellView>
    </AuthRoot>
  )
}
