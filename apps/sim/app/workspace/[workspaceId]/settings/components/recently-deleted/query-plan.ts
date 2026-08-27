import type { RecentlyDeletedTab } from '@/app/workspace/[workspaceId]/settings/components/recently-deleted/search-params'

interface RecentlyDeletedQueryPlan {
  workflows: boolean
  folders: boolean
  tables: boolean
  knowledge: boolean
  knowledgeFolders: boolean
  tableFolders: boolean
  files: boolean
  workspaceFolders: boolean
  chats: boolean
}

export function getRecentlyDeletedQueryPlan(
  activeTab: RecentlyDeletedTab
): RecentlyDeletedQueryPlan {
  const all = activeTab === 'all'
  return {
    workflows: all || activeTab === 'workflow',
    folders: all || activeTab === 'folder',
    tables: all || activeTab === 'table',
    knowledge: all || activeTab === 'knowledge',
    knowledgeFolders: all || activeTab === 'knowledge',
    tableFolders: all || activeTab === 'table',
    files: all || activeTab === 'file',
    workspaceFolders: all || activeTab === 'file',
    chats: all || activeTab === 'chat',
  }
}
