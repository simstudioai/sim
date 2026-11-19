// @sim-sdk 1
import { defineCredentials } from '@sim/workflow-sdk/workspace'

// credentials.ts: the saved credentials workflows use as credential('<key>'), by provider only.
// An apply binds each key to this workspace's credential of that provider. The provider is the
// id `sim credentials connect <provider>` takes (Gmail is 'google-email'); a block's .d.ts names
// the ones its credential accepts (CredentialKeyFor<'google-email' | …>). `name` picks one of
// several credentials of a provider by its display name.
export default defineCredentials({
  slack: { provider: 'slack' },
  gmail: { provider: 'google-email', name: 'Support inbox' },
})
