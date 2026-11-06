import { notFound, redirect } from 'next/navigation'
import { FixtureChatScreen } from '@/platform/app/(shell)/_components/chat/conversation/fixture-chat-screen'
import { readScenario } from '@/platform/design-system/navigation'
import { resolvePlatformMode } from '@/platform/lib/data/mode'
import { workspacePath } from '@/platform/lib/workspace-navigation'

export default async function Page({
  params,
  searchParams,
}: PageProps<'/workspace/[workspaceId]/chat/[[...id]]'>) {
  const [{ workspaceId, id = [] }, query] = await Promise.all([params, searchParams])
  if (
    id.length > 1 ||
    [workspaceId, ...id].some(
      (part) => !part || part === '.' || part === '..' || /[/\\]/.test(part)
    )
  )
    notFound()
  if (resolvePlatformMode() === 'live') {
    const { legacyUrl } = await import('@/platform/lib/data/surface')
    redirect(
      legacyUrl(workspacePath(workspaceId, id[0] ? `chat/${encodeURIComponent(id[0])}` : 'home'))
    )
  }
  return (
    <FixtureChatScreen
      scenario={readScenario(query.state)}
      chatId={id[0]}
      workspaceId={workspaceId}
    />
  )
}
