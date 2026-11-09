import type { MothershipEnvironment } from '@/lib/api/contracts/user'

export interface AdminPreferences {
  superUserModeEnabled: boolean
  mothershipEnvironment: MothershipEnvironment
}

export interface DirectoryUser {
  id: string
  name: string
  email: string
  role: 'user' | 'admin'
  banned: boolean
}

export interface ImportInputs {
  workflow: string
  target: string
}

export interface NewDirectoryUser {
  name: string
  email: string
  emailVerified: boolean
  password?: string
}

/**
 * What the Admin section reads and does, filled by the session's example on fixtures and by the
 * admin queries and mutations on live data.
 */
export interface AdminConsole {
  /** Absent while the first read is pending; null when it failed. */
  settings: AdminPreferences | null | undefined
  retrySettings: () => void
  savingSetting: boolean
  setSuperUserMode: (enabled: boolean) => void
  setMothershipEnvironment: (environment: MothershipEnvironment) => void
  benchmarkAvailable: boolean
  importer: {
    placeholders: ImportInputs
    pending: boolean
    /** An impersonation is underway, so nothing else may start. */
    blocked: boolean
    notice?: { message: string; failed?: boolean }
    reset: () => void
    /** Resolves true when the import landed, so the inputs clear. */
    submit: (inputs: ImportInputs) => Promise<boolean>
  }
  directory: {
    operatorId?: string
    /** The page the URL's search asks for, once read. */
    results?: { users: DirectoryUser[]; total: number }
    searching: boolean
    error?: string
    warning?: string
    status?: string
    recent: DirectoryUser[]
    impersonating: boolean
    busy: (userId: string) => boolean
    impersonate: (user: DirectoryUser) => void
    resetPassword: (user: DirectoryUser) => void
    setRole: (user: DirectoryUser, role: DirectoryUser['role']) => Promise<void>
    ban: (user: DirectoryUser, reason: string) => Promise<void>
    unban: (user: DirectoryUser) => void
    /** Resolves to the created user's email, which the directory then searches for. */
    addUser: (input: NewDirectoryUser) => Promise<string>
  }
}
