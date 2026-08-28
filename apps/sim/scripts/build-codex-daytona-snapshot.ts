#!/usr/bin/env bun

/** Builds the Daytona snapshot used by the Codex Coding Agent block. */

import { Daytona, Image } from '@daytona/sdk'
import { getErrorMessage } from '@sim/utils/errors'
import {
  CODEX_APT,
  CODEX_BUN_VERSION_ASSERT,
  CODEX_CLI_VERSION_ASSERT,
  CODEX_GLOBAL_NPM_PACKAGES,
  CODEX_NODE_MAJOR,
  CODEX_NODE_VERSION_ASSERT,
  CODEX_SANDBOX_CPU_COUNT,
  CODEX_SANDBOX_MEMORY_GB,
} from '@/scripts/codex-sandbox-packages'

const BASE_IMAGE = 'python:3.13-slim-trixie'
const APT_PREFIX = 'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends'
const RESOURCES = {
  cpu: CODEX_SANDBOX_CPU_COUNT,
  memory: CODEX_SANDBOX_MEMORY_GB,
  disk: 10,
} as const

export const codexImage = Image.base(BASE_IMAGE).runCommands(
  `apt-get update && ${APT_PREFIX} curl ca-certificates gnupg && rm -rf /var/lib/apt/lists/*`,
  `apt-get update && curl -fsSL https://deb.nodesource.com/setup_${CODEX_NODE_MAJOR}.x | bash - && ${APT_PREFIX} nodejs && rm -rf /var/lib/apt/lists/* && ${CODEX_NODE_VERSION_ASSERT}`,
  `apt-get update && ${APT_PREFIX} ${CODEX_APT.join(' ')} && rm -rf /var/lib/apt/lists/*`,
  `npm install -g ${CODEX_GLOBAL_NPM_PACKAGES.join(' ')}`,
  `${CODEX_BUN_VERSION_ASSERT} && ${CODEX_CLI_VERSION_ASSERT}`,
  'mkdir -p /workspace'
)

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--print')) {
    console.log(codexImage.dockerfile)
    return
  }

  const nameIndex = args.indexOf('--name')
  const snapshotName = nameIndex === -1 ? process.env.DAYTONA_SNAPSHOT_NAME : args[nameIndex + 1]
  if (!snapshotName?.includes(':')) {
    throw new Error('A Daytona snapshot name with an explicit tag is required')
  }
  if (!process.env.DAYTONA_API_KEY) throw new Error('DAYTONA_API_KEY is required')

  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
  await daytona.snapshot.create(
    { name: snapshotName, image: codexImage, resources: RESOURCES },
    { onLogs: (log: string) => process.stdout.write(`  ${log}`) }
  )
  console.log(`Done. Set in .env: DAYTONA_CODEX_SNAPSHOT_ID=${snapshotName}`)
}

main().catch((error: unknown) => {
  console.error('Build failed:', getErrorMessage(error))
  process.exit(1)
})
