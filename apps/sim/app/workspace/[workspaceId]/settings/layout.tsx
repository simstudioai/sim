'use client'

import { useSettingsBeforeUnload } from '@/components/settings/use-settings-before-unload'

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  useSettingsBeforeUnload()
  return <div className='flex h-full flex-col bg-[var(--bg)]'>{children}</div>
}
