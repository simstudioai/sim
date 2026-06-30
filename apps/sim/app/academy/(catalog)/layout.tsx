import type React from 'react'
import { LogoShell } from '@/app/(landing)/components'

/**
 * Academy catalog chrome — the shared light, logo-only {@link LogoShell} around
 * every academy catalog page. No marketing menus; full-width content.
 */
export default function AcademyCatalogLayout({ children }: { children: React.ReactNode }) {
  return <LogoShell>{children}</LogoShell>
}
