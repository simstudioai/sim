#!/usr/bin/env bun

/**
 * Builds the Daytona snapshot used by Create PR and Review Code — the failover
 * counterpart of `build-pi-e2b-template.ts`.
 *
 * Both renderers consume `pi-sandbox-packages.ts`, so the two providers cannot
 * drift apart.
 *
 * Unlike the E2B template, which layers onto `code-interpreter-v1` (Debian
 * trixie + Python 3.13 + Node 20), Daytona has no equivalent base, so this image
 * reconstructs that foundation: Python for the review tools' helper script and
 * Node 22 for the Pi CLI.
 *
 * Usage:
 *   DAYTONA_API_KEY=... bun run apps/sim/scripts/build-pi-daytona-snapshot.ts --name sim-pi:<tag>
 *   bun run apps/sim/scripts/build-pi-daytona-snapshot.ts --print
 *
 * Daytona rejects the latest/lts/stable tags, so the name MUST carry an explicit
 * tag — CI passes the same `<branch>-<sha>` it uses for ECR images.
 *
 * After it builds, set the printed value in the Sim app's .env:
 *   DAYTONA_PI_SNAPSHOT_ID=<name:tag>
 */

import { Daytona, Image } from '@daytonaio/sdk'
import { getErrorMessage } from '@sim/utils/errors'
import {
  PI_APT,
  PI_NODE_MAJOR,
  PI_NODE_VERSION_ASSERT,
  PI_NPM,
} from '@/scripts/pi-sandbox-packages'

/** Matches E2B's base: Debian 13 (trixie) with Python 3.13 installed to /usr/local. */
const BASE_IMAGE = 'python:3.13-slim-trixie'

/**
 * `daytona-large` sizing. 10 GB is a HARD per-sandbox disk cap — the API rejects
 * anything larger ("Disk request 20GB exceeds maximum allowed per sandbox
 * (10GB)"), regardless of plan tier, and raising it requires contacting Daytona.
 * That is the binding constraint on how large a repo Pi can clone here.
 */
const RESOURCES = { cpu: 4, memory: 8, disk: 10 } as const

const APT_PREFIX = 'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends'

export const piImage = Image.base(BASE_IMAGE).runCommands(
  `apt-get update && ${APT_PREFIX} curl ca-certificates gnupg && rm -rf /var/lib/apt/lists/*`,
  // Node 22 from NodeSource, asserted at build time so an upstream change that
  // ships an older Node fails here rather than at the first agent run.
  `apt-get update && curl -fsSL https://deb.nodesource.com/setup_${PI_NODE_MAJOR}.x | bash - && ${APT_PREFIX} nodejs && rm -rf /var/lib/apt/lists/* && ${PI_NODE_VERSION_ASSERT}`,
  `apt-get update && ${APT_PREFIX} ${PI_APT.join(' ')} && rm -rf /var/lib/apt/lists/*`,
  `npm install -g ${PI_NPM.join(' ')}`,
  // The clone target. E2B's base ships a world-writable /code; Pi writes to
  // /workspace (cloud-review-tools.ts:14), so create it explicitly.
  'mkdir -p /workspace'
)

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--print')) {
    console.log(piImage.dockerfile)
    return
  }

  const nameIdx = args.indexOf('--name')
  const snapshotName = nameIdx !== -1 ? args[nameIdx + 1] : process.env.DAYTONA_SNAPSHOT_NAME
  if (!snapshotName) {
    console.error('A snapshot name is required (--name <name:tag> or DAYTONA_SNAPSHOT_NAME)')
    process.exit(1)
  }
  // Daytona resolves snapshots by exact tag; `latest` is rejected outright, and an
  // untagged name would silently pin to whatever was built last.
  if (!snapshotName.includes(':')) {
    console.error(
      `Snapshot name must include an explicit tag (got "${snapshotName}"). ` +
        'Daytona does not support latest/lts/stable.'
    )
    process.exit(1)
  }
  if (!process.env.DAYTONA_API_KEY) {
    console.error('DAYTONA_API_KEY is required')
    process.exit(1)
  }

  console.log(`Building Pi Daytona snapshot: ${snapshotName}\n`)

  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
  await daytona.snapshot.create(
    { name: snapshotName, image: piImage, resources: RESOURCES },
    { onLogs: (log: string) => process.stdout.write(`  ${log}`) }
  )

  console.log(`\nDone. Set in .env: DAYTONA_PI_SNAPSHOT_ID=${snapshotName}`)
}

main().catch((error: unknown) => {
  console.error('Build failed:', getErrorMessage(error))
  process.exit(1)
})
