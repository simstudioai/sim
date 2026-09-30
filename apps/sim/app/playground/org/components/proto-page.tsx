'use client'

import { notFound } from 'next/navigation'
import { ChatSurface } from '@/app/playground/org/components/chat-surface'
import { IssuePage } from '@/app/playground/org/components/issue-page'
import { NewChatHome } from '@/app/playground/org/components/new-chat-home'
import { ProjectShell } from '@/app/playground/org/components/project-shell'
import { WorkspaceView } from '@/app/playground/org/components/workspace-view'
import { CHATS, type Chat, issueByKey, WORKSPACES } from '@/app/playground/org/lib/mock-data'
import { parseProtoRoute } from '@/app/playground/org/lib/routes'

const NEW_CHAT: Chat = { id: 'new', title: 'New chat', age: 'now' }

/** Client-side router for the prototype's catch-all route. */
export function ProtoPage({ slug }: { slug?: string[] }) {
  const route = parseProtoRoute(slug)
  if (!route) notFound()

  switch (route.kind) {
    case 'home':
      return <NewChatHome />
    case 'search':
      return <Placeholder title='Search' body='Org-wide search stays as it is today.' />
    case 'connectors':
      return <Placeholder title='Connectors' body='Slack, Linear, Jira, Zendesk, and the rest.' />
    case 'chat': {
      const chat = route.chatId === 'new' ? NEW_CHAT : CHATS.find((c) => c.id === route.chatId)
      if (!chat) notFound()
      return <ChatSurface chat={chat} />
    }
    case 'workspace': {
      const workspace = WORKSPACES.find((w) => w.id === route.workspaceId)
      if (!workspace) notFound()
      return (
        <ProjectShell workspace={workspace}>
          <WorkspaceView
            workspace={workspace}
            section={route.section}
            full={route.full}
            settingsSection={route.settingsSection}
          />
        </ProjectShell>
      )
    }
    case 'issue': {
      const workspace = WORKSPACES.find((w) => w.id === route.workspaceId)
      const issue = issueByKey(route.issueKey)
      if (!workspace || !issue || issue.workspaceId !== workspace.id) notFound()
      return (
        <ProjectShell workspace={workspace}>
          <IssuePage key={issue.key} workspace={workspace} issue={issue} />
        </ProjectShell>
      )
    }
  }
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-2'>
      <h1 className='text-[20px] text-[var(--text-primary)]'>{title}</h1>
      <p className='text-[var(--text-muted)] text-small'>{body}</p>
    </div>
  )
}
