import type { WorkspaceCredentialRole } from '@/hooks/queries/credentials'

export interface CredentialRoleOption {
  value: WorkspaceCredentialRole
  label: string
}

/**
 * Roles assignable to a credential member. Shared by every credential detail
 * surface (Integrations, Secrets) so role choices never drift between them.
 */
export const ROLE_OPTIONS: readonly CredentialRoleOption[] = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
] as const
