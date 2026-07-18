export type RequiredOAuthBinding = {
  workflowId: string
  blockId: string
  blockType: string
  subBlockId: string
  serviceId: string
  providerId: string
  requiredScopes: string[]
  currentValue: string | null
}

export type CredentialChoice = {
  id: string
  displayName: string
  providerId: string
}

export type CredentialSelectionRequest = {
  bindingKey: string
  workflowId: string
  blockId: string
  subBlockId: string
  serviceId: string
  providerId: string
  choices: CredentialChoice[]
}

export type CredentialBindingResult =
  | { ok: true; boundCount: number }
  | {
      ok: false
      code: 'CONNECT_REQUIRED' | 'SELECTION_REQUIRED' | 'INVALID_SELECTION' | 'BIND_FAILED'
      error: string
      selections?: CredentialSelectionRequest[]
    }
