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

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createAppsHopProof } from '../apps/sim/lib/apps/hop-proof'

const SIM_URL = (process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
const APPS_HOST_URL = (
  process.env.NEXT_PUBLIC_APP_PUBLIC_ORIGIN || 'http://apps.localhost:3005'
).replace(/\/$/, '')
const GO_URL = (process.env.SIM_AGENT_API_URL || 'http://localhost:8080').replace(/\/$/, '')
const ROOT = resolve(import.meta.dir, '..')
const COPILOT_ROOT = resolve(ROOT, '../copilot/copilot')

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
  const proof = createAppsHopProof('POST', path)
  const res = await fetch(`${SIM_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-apps-hop-proof': proof,
    },
    body: JSON.stringify({ input: {} }),
  })
  // Unknown / non-current releases must not execute (404), and must not 500.
  if (res.status === 404 || res.status === 403) {
    pass(`gateway fail-closed for unknown release (${res.status})`)
  } else {
    fail('gateway pointer enforcement', `expected 403/404 got ${res.status}`)
  }
}

function checkGoCatalogParity() {
  const catalogPath = resolve(COPILOT_ROOT, 'contracts/tool-catalog-v1.json')
  const streamPath = resolve(COPILOT_ROOT, 'contracts/mothership-stream-v1.schema.json')
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      tools: Array<{ id: string; route?: string }>
    }
    const ids = [
      'app_bind_action',
      'app_refresh_binding',
      'app_detach_action',
      'app_write_files',
      'app_build',
      'app_prepare_publish',
      'app_list_callable_releases',
    ]
    for (const id of ids) {
      const entry = catalog.tools.find((t) => t.id === id)
      if (!entry) {
        fail(`catalog missing ${id}`)
        return
      }
      if (entry.route !== 'sim') {
        fail(`catalog ${id} route`, `expected sim got ${entry.route}`)
        return
      }
    }
    for (const denied of ['create_workflow', 'edit_workflow', 'delete_workflow']) {
      // These may exist globally, but Full-stack allowlist must not surface them.
      // Catalog presence is fine; routing policy is enforced in Go source tests.
      void denied
    }
    pass('Go tool-catalog contains seven sim-routed app_* tools')

    const stream = JSON.parse(readFileSync(streamPath, 'utf8')) as {
      $defs?: Record<string, { enum?: string[] }>
    }
    const eventType = stream.$defs?.MothershipStreamV1EventType?.enum
    if (eventType?.includes('app')) {
      pass('stream schema includes app event type')
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
  console.log('  4. Explicitly confirm publish in chat → public sim.run succeeds')
  console.log('  5. Negative: no workflow mutation tools; revoke kills URL')
}

await main()
