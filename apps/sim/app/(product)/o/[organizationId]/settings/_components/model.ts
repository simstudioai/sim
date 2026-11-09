export interface SettingsData {
  email: string
  members: { id: string; name: string; email: string }[]
  connections: string[]
}
