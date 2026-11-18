// @sim-sdk 1
import { defineSecrets } from '@sim/workflow-sdk/workspace'

// secrets.ts: the workspace secrets workflows read as env.NAME, by name and description only.
// A value never appears here: set one with `sim secrets set NAME --scope workspace`.
export default defineSecrets({
  ANTHROPIC_API_KEY: { description: 'Model access for the support agent' },
})
