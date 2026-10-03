export interface CredentialFieldBounds {
  x: number
  y: number
  width: number
  height: number
}

/** No input values leave the isolated page world when discovering a login. */
export interface CredentialFormReport {
  origin: string
  targetId: string | null
  hasLoginForm: boolean
  hasPasswordField: boolean
  bounds: CredentialFieldBounds | null
}

export type CredentialFillStatus = 'filled' | 'stale-target' | 'failed'

export interface CredentialFillRequest {
  requestId: string
  targetId: string
  origin: string
  username: string
  password?: string
}

export interface CredentialFillResult {
  requestId: string
  status: CredentialFillStatus
}

export interface CredentialPickerConfiguration {
  origin: string
  accounts: Array<{ id: string; username: string }>
}

/** Only the bundled account picker receives this bridge; it never receives a password. */
export interface CredentialPickerApi {
  configuration(): Promise<CredentialPickerConfiguration>
  select(id: string): Promise<CredentialFillStatus>
  dismiss(): void
  resize(height: number): void
}
