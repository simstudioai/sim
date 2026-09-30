import { CHANGELOG, DRAFTS } from '@/app/playground/org/fixtures/changelog-data'
import {
  CHATS,
  ISSUES,
  linkedTickets,
  RELEASES,
  ticketUrl,
} from '@/app/playground/org/fixtures/mock-data'
import type { Project } from '@/app/playground/org/lib/project'
import type { IssueChat, ProjectSources } from '@/app/playground/org/lib/project-sources'

const RUNNING_CHAT_IDS: ReadonlySet<string> = new Set(
  DRAFTS.flatMap((draft) => draft.running.map((work) => work.chat.id))
)

/** Chats that produced or are running work on an issue, running ones first. */
function issueChats(project: Project, issueKey: string): IssueChat[] {
  const found = new Map<string, IssueChat>()
  for (const draft of DRAFTS) {
    if (draft.workspaceId !== project.mock.id) continue
    for (const work of draft.running)
      if (work.issue === issueKey) found.set(work.chat.id, { ...work.chat, running: true })
    for (const change of draft.changes)
      if (change.chat && change.issues.includes(issueKey) && !found.has(change.chat.id))
        found.set(change.chat.id, { ...change.chat, running: false })
  }
  for (const entry of CHANGELOG) {
    if (entry.workspaceId !== project.mock.id) continue
    for (const change of entry.changes)
      if (change.chat && change.issues.includes(issueKey) && !found.has(change.chat.id))
        found.set(change.chat.id, { ...change.chat, running: false })
  }
  return [...found.values()]
}

/** The overlay packs as project sources: every entity comes from the pack the project matched. */
export const fixtureProjectSources: ProjectSources = {
  issuesFor: (project) => ISSUES.filter((issue) => issue.workspaceId === project.mock.id),
  changelogFor: (project) => ({
    shipped: CHANGELOG.filter((entry) => entry.workspaceId === project.mock.id),
    draft: DRAFTS.find((draft) => draft.workspaceId === project.mock.id) ?? null,
  }),
  descriptionFor: (project) => (project.overlayMatched ? project.mock.description : ''),
  needsYouFor: (project) => project.mock.needsYou,
  chatsFor: (project) =>
    CHATS.filter((chat) => chat.workspaceId === project.mock.id).map((chat) => ({
      ...chat,
      running: RUNNING_CHAT_IDS.has(chat.id),
    })),
  issueChatsFor: issueChats,
  releaseFor: (_project, issue) => RELEASES.find((release) => release.id === issue.releaseId),
  linkedTicketsFor: (_project, issue) => linkedTickets(issue),
  ticketUrl,
}
