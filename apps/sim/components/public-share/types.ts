/**
 * Which family of public share a gate is protecting. Selects the copy, the
 * auth-exchange endpoint, and the base path used to build the SSO callback —
 * everything else about the three gates is identical. A union of one today;
 * it widens as further resource families gain a public route.
 */
export type PublicShareKind = 'file'

export interface PublicShareGateProps {
  /** The public share token, used as the auth-exchange path parameter. */
  token: string
  kind: PublicShareKind
}
