import type { ReactNode } from 'react'
import { InterfacesSupportFooter } from '@/app/(interfaces)/components/interfaces-shell/interfaces-support-footer'
import { LogoShell } from '@/app/(landing)/components/logo-shell'

/**
 * Existing interface chrome for resume and chat availability states.
 * Resource authentication gates use the independent AuthShell instead.
 */
interface InterfacesShellProps {
  children: ReactNode
}

export function InterfacesShell({ children }: InterfacesShellProps) {
  return <LogoShell footer={<InterfacesSupportFooter />}>{children}</LogoShell>
}
