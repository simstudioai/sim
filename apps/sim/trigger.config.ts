import { defineConfig } from '@trigger.dev/sdk'

export default defineConfig({
  project: 'proj_kufttkwzywcydwtccqhx',
  runtime: 'node',
  logLevel: 'log',
  maxDuration: 180,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ['./background'],
})
