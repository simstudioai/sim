export type MemberSecretSource = { name: string; description: string; setupGuideUrl: string } & (
  | { mode: 'organization' }
  | { mode: 'member'; names: readonly string[] }
)
