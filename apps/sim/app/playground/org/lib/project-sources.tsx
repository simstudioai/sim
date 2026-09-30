'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { Project } from '@/app/playground/org/lib/project'
import type {
  ChangeChat,
  ChangelogEntry,
  Chat,
  DraftRelease,
  Issue,
  LinkedTicket,
  Release,
} from '@/app/playground/org/lib/types'

/** A chat of the project, with whether Sim is still working in it. */
export interface ProjectChat extends Chat {
  running: boolean
}

/** A chat that produced or is running work on an issue. */
export interface IssueChat extends ChangeChat {
  running: boolean
}

/** One environment's changelog: what shipped, and the next release being drafted with its running work. */
export interface ProjectChangelog {
  shipped: ChangelogEntry[]
  draft: DraftRelease | null
}

/**
 * Where the project view reads the entities that have no real source yet. The playground mounts
 * the fixture packs; the graduated surface ships with `emptyProjectSources` until each entity
 * gets a real source.
 */
export interface ProjectSources {
  /** Issues are shared by every environment of a project. */
  issuesFor(project: Project): Issue[]
  changelogFor(project: Project): ProjectChangelog
  /** The project's purpose line; empty when the source has none, so the caller falls back. */
  descriptionFor(project: Project): string
  /** How many issues wait on a person; the sidebar badge. */
  needsYouFor(project: Project): number
  chatsFor(project: Project): ProjectChat[]
  issueChatsFor(project: Project, issueKey: string): IssueChat[]
  releaseFor(project: Project, issue: Issue): Release | undefined
  linkedTicketsFor(project: Project, issue: Issue): LinkedTicket[]
  ticketUrl(ticket: LinkedTicket): string
}

/** No source behind any entity: empty lists, no badge, and the workspace description fallback. */
export const emptyProjectSources: ProjectSources = {
  issuesFor: () => [],
  changelogFor: () => ({ shipped: [], draft: null }),
  descriptionFor: () => '',
  needsYouFor: () => 0,
  chatsFor: () => [],
  issueChatsFor: () => [],
  releaseFor: () => undefined,
  linkedTicketsFor: (_project, issue) => issue.linked ?? [],
  ticketUrl: () => '',
}

const ProjectSourcesContext = createContext<ProjectSources | null>(null)

interface ProjectSourcesProviderProps {
  sources: ProjectSources
  children: ReactNode
}

export function ProjectSourcesProvider({ sources, children }: ProjectSourcesProviderProps) {
  return <ProjectSourcesContext.Provider value={sources}>{children}</ProjectSourcesContext.Provider>
}

export function useProjectSources(): ProjectSources {
  const sources = useContext(ProjectSourcesContext)
  if (!sources) throw new Error('useProjectSources must be used within ProjectSourcesProvider')
  return sources
}
