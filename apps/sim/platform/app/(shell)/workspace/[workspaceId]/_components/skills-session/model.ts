export interface SkillFields {
  name: string
  description: string
  content: string
}

export interface WorkspaceSkill extends SkillFields {
  id: string
  access: 'editor' | 'viewer' | 'built-in'
  editorIds: string[]
}

export interface SkillsData {
  skills: WorkspaceSkill[]
  members: { id: string; name: string; email: string; admin?: boolean }[]
  viewerId: string
  canCreate: boolean
}
