import type { AdminPreferences, DirectoryUser } from '@/platform/lib/data/admin-model'

export interface AdminExample extends AdminPreferences {
  operatorId: string
  users: DirectoryUser[]
  recent: string[]
  workflows: { id: string; workspaceId: string; chats: number }[]
  workspaces: string[]
}
