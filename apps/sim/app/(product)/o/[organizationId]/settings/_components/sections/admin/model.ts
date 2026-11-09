export interface AdminPreferences {
  superUserModeEnabled: boolean
  mothershipEnvironment: string
}

export interface DirectoryUser {
  id: string
  name: string
  email: string
  role: 'user' | 'admin'
  banned: boolean
  banReason?: string
  emailVerified: boolean
}

export interface AdminExample extends AdminPreferences {
  operatorId: string
  users: DirectoryUser[]
  recent: string[]
  workflows: { id: string; workspaceId: string; chats: number }[]
  workspaces: string[]
}
