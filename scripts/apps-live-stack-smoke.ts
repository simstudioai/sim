#!/usr/bin/env bun

/**
 * Live-stack smoke for Full-stack Apps Phase 1.
 *
 * Stable, repeatable checks that do not require an LLM turn:
 *   1) apps-host health
 *   2) gateway rejects missing hop proof
 *   3) gateway rejects unknown/non-current release even with a valid hop proof
 *   4) Go tool catalog contains the seven app_* tools with route=sim
 *   5) stream contract accepts typed `app` envelopes
 *
 * Optional (APPS_LIVE_E2E=1): when SIM_AGENT_API_URL is reachable, assert the
 * mothership health/version endpoint responds (Full-stack chat still needs a
 * human/admin turn in the UI for the LLM path).
 *
 * Usage:
 *   bun run scripts/apps-live-stack-smoke.ts
 *   APPS_LIVE_E2E=1 bun run scripts/apps-live-stack-smoke.ts
 */

import { createAppsHopProof } from '../apps/sim/lib/apps/hop-proof'
import { MOTHERSHIP_STREAM_V1_SCHEMA } from '../apps/sim/lib/copilot/generated/mothership-stream-v1-schema'
import {
  AppBindAction,
  AppBuild,
  AppDetachAction,
  AppListCallableReleases,
  AppPreparePublish,
  AppRefreshBinding,
  AppWriteFiles,
} from '../apps/sim/lib/copilot/generated/tool-catalog-v1'

const SIM_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const APPS_HOST_URL = (
  process.env.NEXT_PUBLIC_APP_PUBLIC_ORIGIN || 'http://apps.localhost:3005'
).replace(/\/$/, '')
const GO_URL = (process.env.SIM_AGENT_API_URL || 'http://localhost:8080').replace(/\/$/, '')

let failed = 0

function pass(label: string) {
  console.log(`✓ ${label}`)
}

function fail(label: string, detail?: string) {
  failed += 1
  console.error(`✗ ${label}${detail ? ` — ${detail}` : ''}`)
}

async function checkAppsHostHealth() {
  const res = await fetch(`${APPS_HOST_URL}/health`)
  const body = (await res.json().catch(() => null)) as { ok?: boolean; service?: string } | null
  if (res.ok && body?.ok && body.service === 'apps-host') {
    pass(`apps-host health (${APPS_HOST_URL})`)
  } else {
    fail('apps-host health', `status=${res.status} body=${JSON.stringify(body)}`)
  }
}

async function checkGatewayHopRejection() {
  const path = '/api/apps/gateway/releases/smoke-release/actions/main'
  const res = await fetch(`${SIM_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: {} }),
  })
  if (res.status === 403) {
    pass('gateway rejects missing hop proof (403)')
  } else {
    fail('gateway hop rejection', `expected 403 got ${res.status}`)
  }
}

async function checkGatewayPointerEnforcement() {
  const path = '/api/apps/gateway/releases/00000000-0000-4000-8000-000000000000/actions/main'
  const body = JSON.stringify({ input: {} })
  const proof = createAppsHopProof('POST', path, body)
  const res = await fetch(`${SIM_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sim-apps-hop': proof,
    },
    body,
  })
  // A valid body-bound hop must reach pointer enforcement, then fail unknown.
  if (res.status === 404) {
    pass('gateway rejects unknown/non-current release after valid hop (404)')
  } else {
    fail('gateway pointer enforcement', `expected 404 got ${res.status}`)
  }
}

function checkGoCatalogParity() {
  try {
    const tools = [
      AppBindAction,
      AppRefreshBinding,
      AppDetachAction,
      AppWriteFiles,
      AppBuild,
      AppPreparePublish,
      AppListCallableReleases,
    ]
    const permissions: Record<string, string> = {
      app_bind_action: 'admin',
      app_refresh_binding: 'admin',
      app_detach_action: 'admin',
      app_write_files: 'write',
      app_build: 'write',
      app_prepare_publish: 'admin',
      app_list_callable_releases: 'write',
    }
    for (const [id, permission] of Object.entries(permissions)) {
      const entry = tools.find((tool) => tool.id === id)
      if (!entry) {
        fail(`catalog missing ${id}`)
        return
      }
      if (entry.route !== 'sim') {
        fail(`catalog ${id} route`, `expected sim got ${entry.route}`)
        return
      }
      if (entry.requiredPermission !== permission) {
        fail(`catalog ${id} permission`, `expected ${permission} got ${entry.requiredPermission}`)
        return
      }
      if (id === 'app_prepare_publish' && entry.parameters?.properties?.publish) {
        fail('catalog app_prepare_publish', 'model-routed tool must not expose publish')
        return
      }
    }
    for (const denied of ['create_workflow', 'edit_workflow', 'delete_workflow']) {
      // These may exist globally, but Full-stack allowlist must not surface them.
      // Catalog presence is fine; routing policy is enforced in Go source tests.
      void denied
    }
    pass('Go tool-catalog matches the locked App routes and permission matrix')

    const stream = MOTHERSHIP_STREAM_V1_SCHEMA as {
      $defs?: Record<string, { enum?: string[] }>
    }
    const eventType = stream.$defs?.MothershipStreamV1EventType?.enum
    const appEnvelopeType = stream.$defs?.MothershipStreamV1AppEnvelopeType?.enum
    if (
      eventType?.includes('app') &&
      appEnvelopeType?.length === 1 &&
      appEnvelopeType[0] === 'app'
    ) {
      pass('stream schema keeps app as a literal envelope discriminator')
    } else {
      fail('stream schema missing app event type')
    }
  } catch (error) {
    fail('contract files', error instanceof Error ? error.message : String(error))
  }
}

async function checkGoOptional() {
  if (process.env.APPS_LIVE_E2E !== '1') {
    console.log('· skip Go live check (set APPS_LIVE_E2E=1 to enable)')
    return
  }
  try {
    const res = await fetch(`${GO_URL}/healthz`).catch(() => null)
    if (res?.ok) {
      pass(`Go agent health (${GO_URL})`)
    } else {
      // Some builds expose /health instead.
      const alt = await fetch(`${GO_URL}/health`).catch(() => null)
      if (alt?.ok) {
        pass(`Go agent health (${GO_URL}/health)`)
      } else {
        fail('Go agent health', `unreachable at ${GO_URL}`)
      }
    }
  } catch (error) {
    fail('Go agent health', error instanceof Error ? error.message : String(error))
  }
}

async function main() {
  console.log('Apps live-stack smoke')
  console.log(`  Sim:       ${SIM_URL}`)
  console.log(`  Apps-host: ${APPS_HOST_URL}`)
  console.log(`  Go:        ${GO_URL}`)
  console.log('')

  checkGoCatalogParity()
  await checkAppsHostHealth()
  await checkGatewayHopRejection()
  await checkGatewayPointerEnforcement()
  await checkGoOptional()

  console.log('')
  if (failed > 0) {
    console.error(`FAILED (${failed})`)
    process.exit(1)
  }
  console.log('OK — stable live-stack smoke passed')
  console.log('')
  console.log('Manual UI vertical slice (admin user):')
  console.log('  1. Home → Full-stack → new chat')
  console.log('  2. Create/open linked App → bind deployed workflow')
  console.log('  3. Write files → build → preview → prepare')
  console.log('  4. Explicitly confirm publish in Apps UI → public sim.run succeeds')
  console.log('  5. Negative: no workflow mutation tools; revoke kills URL')
}

await main()
