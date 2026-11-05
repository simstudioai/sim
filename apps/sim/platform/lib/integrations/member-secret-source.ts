export type MemberSecretSource = { name: string; description: string } & (
  | { mode: 'organization' }
  | { mode: 'member'; names: readonly string[] }
)
