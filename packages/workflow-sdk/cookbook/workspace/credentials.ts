// @sim-sdk 1
import { defineCredentials } from '@sim/workflow-sdk/workspace'

// credentials.ts: the saved credentials workflows use as credential('<key>'), by provider only.
// An apply binds each key to this workspace's credential of that provider.
export default defineCredentials({
  slack: { provider: 'slack' },
})
