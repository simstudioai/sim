import type { CredentialSelectionRequest } from '@/lib/apps/credential-binding-types'

export type DemoPhase =
  | 'building_backend'
  | 'binding_credentials'
  | 'credential_selection_required'
  | 'generating_frontend'
  | 'frontend_generated'
  | 'building_app'
  | 'preview_ready'
  | 'failed'

export type DemoProgressEvent = {
  phase: DemoPhase
  message?: string
  projectId?: string
  chatId?: string
  revisionId?: string
  buildId?: string
  sessionId?: string
  /** Preview bridge nonce when phase is preview_ready. */
  channelNonce?: string
  appPublicOrigin?: string
  artifactPreview?: boolean
  workflowCount?: number
  actionIds?: string[]
  frontendSource?: 'hosted' | 'fallback'
  frontendFiles?: string[]
  repairAttempted?: boolean
  error?: string
  code?: string
  /** Creator-only credential choices when multiple accounts match. */
  credentialSelections?: CredentialSelectionRequest[]
}
