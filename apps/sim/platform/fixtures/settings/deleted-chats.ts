import type { SettingsFixtureState } from '@/platform/fixtures/settings/state'

interface SampleChat {
  id: string
  title: string | null
  updatedAt: string
  deletedAt: string | null
}

function sampleChats(state: SettingsFixtureState): SampleChat[] {
  if (state.scenario === 'empty') return []
  const titles: (string | null)[] = ['Launch review', 'Customer handoff', 'Incident follow-up']
  if (state.scenario === 'stress') {
    titles.push(
      'International customer onboarding handoff for the operations and platform engineering teams',
      null,
      ...Array.from({ length: 30 }, (_, index) => `Support review · Case ${1200 + index}`)
    )
  }
  return titles.map((title, index) => {
    const deletedAt = new Date(
      state.referenceTime - Math.floor(index / 2) * 86_400_000
    ).toISOString()
    return {
      id: index === 0 ? 'archived-chat' : `archived-chat-${index}`,
      title,
      updatedAt: deletedAt,
      deletedAt,
    }
  })
}

export function deletedChatsFixture(request: Request, path: string, state: SettingsFixtureState) {
  const list = path === '/api/mothership/chats' && request.method === 'GET'
  const restoreId =
    request.method === 'POST'
      ? /^\/api\/mothership\/chats\/([^/]+)\/restore$/.exec(path)?.[1]
      : undefined
  if (!list && !restoreId) return
  const chats =
    (state.records.get('deletedChats') as SampleChat[] | undefined) ?? sampleChats(state)
  if (restoreId) {
    const chat = chats.find((item) => item.id === restoreId && item.deletedAt)
    if (!chat) return Response.json({ success: false, error: 'Chat not found' }, { status: 404 })
    chat.deletedAt = null
    chat.updatedAt = new Date(state.referenceTime).toISOString()
    state.records.set('deletedChats', chats)
    return { success: true }
  }
  const query = new URL(request.url).searchParams
  if (query.get('organizationId') !== state.organizationId || query.has('workspaceId'))
    return Response.json({ error: 'Organization access denied' }, { status: 403 })
  const scope = query.get('scope') ?? 'active'
  if (scope !== 'active' && scope !== 'archived')
    return Response.json({ error: 'Unknown chat scope' }, { status: 400 })
  return {
    success: true,
    data: chats
      .filter((chat) => (chat.deletedAt !== null) === (scope === 'archived'))
      .map((chat) => ({
        ...chat,
        mode: 'assistant',
        lastSeenAt: chat.updatedAt,
        activeStreamId: null,
        pinned: false,
      })),
  }
}
