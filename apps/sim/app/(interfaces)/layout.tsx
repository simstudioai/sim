import type { ReactNode } from 'react'
import { InterfacesShell } from '@/app/(interfaces)/components'

/**
 * Route-group layout for runtime interfaces — chat (`/chat/:identifier`) and
 * resume (`/resume/...`). It renders the shared {@link InterfacesShell} (light,
 * logo-only chrome) around every interface page, so their entry/gate screens get
 * the same frame as the auth sign-in pages. Immersive states (the live chat
 * overlay, voice mode) render full-screen on top of this frame.
 */
export default function InterfacesLayout({ children }: { children: ReactNode }) {
  return <InterfacesShell>{children}</InterfacesShell>
}
