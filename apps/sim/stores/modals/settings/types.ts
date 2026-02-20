export type SettingsSection =
  | 'general'
  | 'credentials'
  | 'template-profile'
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
