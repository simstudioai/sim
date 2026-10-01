'use client'

import { Layout, ListChecks, Rss, Workflow } from '@sim/emcn/icons'
import { generateShortId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { useRouter } from 'next/navigation'
import { BrowseRow, BrowseSection } from '@/app/playground/org/components/browse-rows'
import { MockComposer } from '@/app/playground/org/components/mock-composer'
import { useProtoChats } from '@/app/playground/org/lib/chat-store'
import { PEOPLE } from '@/app/playground/org/lib/mock-data'
import { protoRoutes } from '@/app/playground/org/lib/routes'

/** What Sim suggests doing next, from what is waiting across the projects. */
const RECOMMENDATIONS = [
  { icon: ListChecks, text: 'Approve the refund policy edit waiting in Support desk' },
  { icon: Workflow, text: 'Redeploy slack-support-bot now that INF-412 is ready' },
  { icon: Rss, text: 'Release the 3 changes drafted for Support desk this week' },
  { icon: Layout, text: 'Why did escalations go up on Infra analyzer yesterday?' },
] as const

/** Home: ask, or take a suggestion. Either starts a chat. */
export function HomeView() {
  const router = useRouter()
  const createChat = useProtoChats((state) => state.createChat)
  const firstName = PEOPLE.teddy.name.split(' ')[0]
  const start = (text: string) => {
    const id = `c-${generateShortId(8)}`
    createChat({ id, title: truncate(text, 48), age: 'now' })
    router.push(protoRoutes.chat(id))
  }
  return (
    <div className='flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-6 py-8'>
      <div className='flex w-full max-w-chat flex-col gap-8'>
        <h1 className='text-balance text-center font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
          What should we get done, {firstName}?
        </h1>
        <MockComposer placeholder='Do anything' onSubmit={start} />
        <BrowseSection label='Suggested'>
          {RECOMMENDATIONS.map((item) => (
            <BrowseRow key={item.text} onClick={() => start(item.text)}>
              <item.icon className='size-[14px] shrink-0 text-[var(--text-icon)]' />
              <span className='min-w-0 flex-1 truncate text-[var(--text-body)]'>{item.text}</span>
            </BrowseRow>
          ))}
        </BrowseSection>
      </div>
    </div>
  )
}
