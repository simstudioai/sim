export type SettingsSection =
  | 'general'
  | 'environment'
  | 'template-profile'
  | 'integrations'
  | 'apikeys'
  | 'files'
  | 'subscription'
  | 'team'
  | 'sso'
  | 'copilot'
  | 'mcp'
  | 'custom-tools'
  | 'workflow-mcp-servers'

export interface SettingsModalState {
  isOpen: boolean
  initialSection: SettingsSection | null
  mcpServerId: string | null

  openModal: (options?: { section?: SettingsSection; mcpServerId?: string }) => void
  closeModal: () => void
  clearInitialState: () => void
}
