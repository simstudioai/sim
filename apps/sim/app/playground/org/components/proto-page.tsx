'use client'

import type { ReactNode } from 'react'
import { notFound } from 'next/navigation'
import { IssuePage } from '@/app/playground/org/components/issue-page'
import { LiveChat } from '@/app/playground/org/components/live-chat'
import { NewChatHome } from '@/app/playground/org/components/new-chat-home'
import { ProjectShell } from '@/app/playground/org/components/project-shell'
import { WorkspaceView } from '@/app/playground/org/components/workspace-view'
import { issueByKey } from '@/app/playground/org/lib/mock-data'
import { type Project, useProject, useProjects } from '@/app/playground/org/lib/project'
import { parseProtoRoute } from '@/app/playground/org/lib/routes'
import { useOrganizationMothershipChats } from '@/hooks/queries/mothership-chats'

/** Client-side router for the prototype's catch-all and project routes. */
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
    case 'chat':
      return <OrgChat chatId={route.chatId} />
    case 'workspace':
      return (
        <ProjectRoute workspaceId={route.workspaceId}>
          {(project) => (
            <ProjectShell project={project}>
              <WorkspaceView
                project={project}
                section={route.section}
                full={route.full}
                settingsSection={route.settingsSection}
              />
            </ProjectShell>
          )}
        </ProjectRoute>
      )
    case 'issue':
      return (
        <ProjectRoute workspaceId={route.workspaceId}>
          {(project) => {
            const issue = issueByKey(route.issueKey)
            if (!issue || issue.workspaceId !== project.mock.id) {
              if (project.overlayPending) return <Loading label='Loading issue…' />
              notFound()
            }
            return (
              <ProjectShell project={project}>
                <IssuePage key={issue.key} project={project} issue={issue} />
              </ProjectShell>
            )
          }}
        </ProjectRoute>
      )
  }
}

interface ProjectRouteProps {
  workspaceId: string
  children: (project: Project) => ReactNode
}

/** Resolves the real workspace behind a project route before rendering it. */
function ProjectRoute({ workspaceId, children }: ProjectRouteProps) {
  const { project, isPending } = useProject(workspaceId)
  if (project) return <>{children(project)}</>
  if (isPending) return <Loading label='Loading project…' />
  notFound()
}

/** An org-wide chat: Sim over the organization instead of one project. */
function OrgChat({ chatId }: { chatId: string }) {
  const { projects, isPending } = useProjects()
  const organizationId = projects.find((project) => project.organizationId)?.organizationId
  if (!organizationId)
    return isPending ? (
      <Loading label='Loading chat…' />
    ) : (
      <Placeholder title='Chat' body='Org-wide chats need an organization.' />
    )
  return <OrgChatView organizationId={organizationId} chatId={chatId} />
}

function OrgChatView({ organizationId, chatId }: { organizationId: string; chatId: string }) {
  const { data: chats } = useOrganizationMothershipChats(organizationId)
  const title = chats?.find((chat) => chat.id === chatId)?.name ?? 'Chat'
  return (
    <div className='flex h-full flex-col'>
      <header className='flex h-12 shrink-0 items-center border-[var(--border)] border-b px-6 text-[var(--text-body)] text-small'>
        {title}
      </header>
      <LiveChat
        owner={{ organizationId }}
        chatId={chatId}
        layout='mothership-view'
        className='min-h-0 flex-1'
      />
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return <p className='p-6 text-[var(--text-muted)] text-caption'>{label}</p>
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className='flex h-full flex-col items-center justify-center gap-2'>
      <h1 className='text-[20px] text-[var(--text-primary)]'>{title}</h1>
      <p className='text-[var(--text-muted)] text-small'>{body}</p>
    </div>
  )
}
