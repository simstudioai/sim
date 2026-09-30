'use client'

import { ChipTag } from '@sim/emcn'
import { generateShortId } from '@sim/utils/id'
import { truncate } from '@sim/utils/string'
import { useRouter } from 'next/navigation'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { BrowseRow, BrowseSection } from '@/app/playground/org/components/browse-rows'
import { MockComposer } from '@/app/playground/org/components/mock-composer'
import { useProtoChats } from '@/app/playground/org/lib/chat-store'
import { PEOPLE, WORKSPACES } from '@/app/playground/org/lib/mock-data'
import { protoRoutes } from '@/app/playground/org/lib/routes'

/** Home: ask, or pick a project to open in the workspace pane. Asking starts a chat. */
export function HomeView() {
  const router = useRouter()
  const createChat = useProtoChats((state) => state.createChat)
  const firstName = PEOPLE.teddy.name.split(' ')[0]
  return (
    <div className='flex h-full min-h-0 flex-col items-center justify-center overflow-y-auto px-6 py-8'>
      <div className='flex w-full max-w-chat flex-col gap-8'>
        <h1 className='text-balance text-center font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
          What should we get done, {firstName}?
        </h1>
        <MockComposer
          placeholder='Do anything'
          onSubmit={(text) => {
            const id = `c-${generateShortId(8)}`
            createChat({ id, title: truncate(text, 48), age: 'now' })
            router.push(protoRoutes.chat(id))
          }}
        />
        <BrowseSection label='Projects'>
          {WORKSPACES.map((workspace) => (
            <BrowseRow key={workspace.id} href={protoRoutes.workspace(workspace.id)}>
              <IdentityTile initial={workspace.name[0]} />
              <span className='shrink-0 text-[var(--text-body)]'>{workspace.name}</span>
              <span className='min-w-0 flex-1 truncate text-[var(--text-muted)]'>
                {workspace.description}
              </span>
              {workspace.needsYou > 0 && <ChipTag variant='gray'>{workspace.needsYou}</ChipTag>}
            </BrowseRow>
          ))}
        </BrowseSection>
      </div>
    </div>
  )
}
