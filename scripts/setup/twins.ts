/**
 * Server/client feature-flag pairs that must be set together — server code
 * reads the bare var, the browser bundle reads the NEXT_PUBLIC_ twin
 * (apps/sim/lib/core/config/env-flags.ts documents each). Note the one
 * mismatched pair: DEPLOY_AS_BLOCK ↔ NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED.
 */
export const FLAG_TWINS: ReadonlyArray<{ server: string; client: string }> = [
  { server: 'BILLING_ENABLED', client: 'NEXT_PUBLIC_BILLING_ENABLED' },
  { server: 'ACCESS_CONTROL_ENABLED', client: 'NEXT_PUBLIC_ACCESS_CONTROL_ENABLED' },
  { server: 'ORGANIZATIONS_ENABLED', client: 'NEXT_PUBLIC_ORGANIZATIONS_ENABLED' },
  { server: 'WHITELABELING_ENABLED', client: 'NEXT_PUBLIC_WHITELABELING_ENABLED' },
  { server: 'AUDIT_LOGS_ENABLED', client: 'NEXT_PUBLIC_AUDIT_LOGS_ENABLED' },
  { server: 'DATA_RETENTION_ENABLED', client: 'NEXT_PUBLIC_DATA_RETENTION_ENABLED' },
  { server: 'DATA_DRAINS_ENABLED', client: 'NEXT_PUBLIC_DATA_DRAINS_ENABLED' },
  { server: 'FORKING_ENABLED', client: 'NEXT_PUBLIC_FORKING_ENABLED' },
  { server: 'INBOX_ENABLED', client: 'NEXT_PUBLIC_INBOX_ENABLED' },
  { server: 'DISABLE_INVITATIONS', client: 'NEXT_PUBLIC_DISABLE_INVITATIONS' },
  { server: 'DISABLE_PUBLIC_API', client: 'NEXT_PUBLIC_DISABLE_PUBLIC_API' },
  { server: 'SSO_ENABLED', client: 'NEXT_PUBLIC_SSO_ENABLED' },
  { server: 'EMAIL_PASSWORD_SIGNUP_ENABLED', client: 'NEXT_PUBLIC_EMAIL_PASSWORD_SIGNUP_ENABLED' },
  { server: 'E2B_ENABLED', client: 'NEXT_PUBLIC_E2B_ENABLED' },
  { server: 'DEPLOY_AS_BLOCK', client: 'NEXT_PUBLIC_CUSTOM_BLOCKS_ENABLED' },
]

/** Self-host feature unlocks offered by the wizard's Custom flow. */
export const SELF_HOST_UNLOCKS: ReadonlyArray<{ server: string; label: string; hint: string }> = [
  {
    server: 'ACCESS_CONTROL_ENABLED',
    label: 'Access control',
    hint: 'permission groups (implies organizations)',
  },
  { server: 'ORGANIZATIONS_ENABLED', label: 'Organizations', hint: 'multi-workspace orgs' },
  { server: 'AUDIT_LOGS_ENABLED', label: 'Audit logs', hint: '' },
  { server: 'DATA_RETENTION_ENABLED', label: 'Data retention', hint: 'retention policies' },
  { server: 'DATA_DRAINS_ENABLED', label: 'Data drains', hint: 'export streams' },
  { server: 'FORKING_ENABLED', label: 'Workflow forking', hint: '' },
  { server: 'INBOX_ENABLED', label: 'Inbox', hint: '' },
  { server: 'WHITELABELING_ENABLED', label: 'Whitelabeling', hint: 'custom branding' },
  {
    server: 'DEPLOY_AS_BLOCK',
    label: 'Deploy as block',
    hint: 'publish workflows as reusable blocks',
  },
]

const MAIL_PROVIDER_KEYS = [
  'RESEND_API_KEY',
  'AWS_SES_REGION',
  'SMTP_HOST',
  'AZURE_ACS_CONNECTION_STRING',
  'GMAIL_CREDENTIALS_JSON',
] as const

export function hasMailProvider(vars: Map<string, string>): boolean {
  return MAIL_PROVIDER_KEYS.some((key) => vars.get(key))
}

export const LOGIN_PROVIDERS = [
  { id: 'google', label: 'Google', idKey: 'GOOGLE_CLIENT_ID', secretKey: 'GOOGLE_CLIENT_SECRET' },
  { id: 'github', label: 'GitHub', idKey: 'GITHUB_CLIENT_ID', secretKey: 'GITHUB_CLIENT_SECRET' },
  {
    id: 'microsoft',
    label: 'Microsoft',
    idKey: 'MICROSOFT_CLIENT_ID',
    secretKey: 'MICROSOFT_CLIENT_SECRET',
  },
] as const
