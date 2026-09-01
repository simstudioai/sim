import { notFound } from 'next/navigation'
import { isChatEnabled } from '@/lib/core/config/env-flags'

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  if (!isChatEnabled) notFound()

  return <div className='flex h-full flex-1 flex-col overflow-hidden'>{children}</div>
}
