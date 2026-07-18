import type { Metadata } from 'next'
import { Launcher } from '@/app/desktop/launcher/launcher'

export const metadata: Metadata = {
  title: 'Quick Ask — Sim',
  robots: { index: false },
}

/**
 * The Quick Ask panel surface. Loaded exclusively inside the Sim desktop
 * app's floating launcher window (summoned with the global shortcut or from
 * the menu bar icon); in a regular browser it renders a pointer back to the
 * desktop app.
 */
export default function DesktopLauncherPage() {
  return <Launcher />
}
