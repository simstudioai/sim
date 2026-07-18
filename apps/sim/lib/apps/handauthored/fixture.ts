/**
 * Internal hand-authored vertical-slice fixture.
 * Not a production upload path — use only in tests / local E2E.
 */

import { withSchemaHash } from '@/lib/apps/manifest'
import { APP_TEMPLATE_FILES } from '@/lib/apps/template/versions'

export const HAND_AUTHORED_FIXTURE_ACTIONS = [
  withSchemaHash({
    actionId: 'main',
    workflowId: 'fixture-workflow-id',
    deploymentVersionId: 'fixture-deployment-version-id',
    inputSchema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object' },
    outputAllowlist: [],
    executionPolicy: 'sync' as const,
  }),
]

export const HAND_AUTHORED_FIXTURE_FILES = {
  ...APP_TEMPLATE_FILES,
  'src/App.tsx': `import { createSimClient } from '@sim/app-sdk'

export function App() {
  return (
    <main>
      <h1>Hand-authored fixture</h1>
      <button
        type="button"
        onClick={async () => {
          const config = window.__SIM_APP_CONFIG!
          const client = createSimClient({
            mode: 'published',
            config,
            getAbuseToken: async () => {
              const existing = sessionStorage.getItem('sim_abuse_token')
              if (existing) return existing
              const visitorId = localStorage.getItem('sim_visitor_id') || crypto.randomUUID()
              localStorage.setItem('sim_visitor_id', visitorId)
              const res = await fetch('/__sim/abuse/session', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ publicId: config.publicId, visitorId }),
              })
              const json = await res.json()
              if (!res.ok || !json.abuseToken) throw new Error(json.error || 'Abuse session failed')
              sessionStorage.setItem('sim_abuse_token', json.abuseToken)
              return json.abuseToken
            },
          })
          await client.run('main', {})
        }}
      >
        Run
      </button>
    </main>
  )
}
`,
}
