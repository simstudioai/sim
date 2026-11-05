export type MemberSecretSource =
  | { mode: 'organization' }
  | { mode: 'member'; names: readonly string[] }
