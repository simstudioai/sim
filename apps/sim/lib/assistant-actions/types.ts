type AssistantToolPolicy = 'allow' | 'ask' | 'block'

export interface AssistantToolPermissionScope {
  organizationId: string
  userId: string
  credentialId: string
}

export interface AssistantToolPermissions {
  revision: number
  readPolicy: AssistantToolPolicy
  writePolicy: AssistantToolPolicy
  overrides: Record<string, { version: number; policy: AssistantToolPolicy }>
}

export type AssistantToolPermissionChange =
  | { kind: 'group'; effect: 'read' | 'write'; policy: AssistantToolPolicy }
  | { kind: 'tool'; toolId: string; policy: AssistantToolPolicy | null }
