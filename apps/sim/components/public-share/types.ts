/**
 * Which family of public share a gate is protecting. Selects the copy, the
 * auth-exchange endpoint, and the `/f` vs `/i` base path used to build the SSO
 * callback — everything else about the three gates is identical.
 */
export type PublicShareKind = 'file' | 'interface'

export interface PublicShareGateProps {
  /** The public share token, used as the auth-exchange path parameter. */
  token: string
  kind: PublicShareKind
}
