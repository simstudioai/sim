#!/usr/bin/env bun

/**
 * Builds the Daytona snapshot equivalent of the dedicated Function E2B base.
 * Both renderers consume `function-sandbox-packages.ts`, keeping their runtime
 * and universal command surfaces aligned.
 *
 * Usage:
 * `DAYTONA_API_KEY=... bun run apps/sim/scripts/build-function-daytona-snapshot.ts --name sim-function-<release> --parity-manifest /tmp/function-sandbox-manifest.json`
 *
 * Configure the exact snapshot as `DAYTONA_FUNCTION_SNAPSHOT_ID`. There is
 * intentionally no fallback to `DAYTONA_SHELL_SNAPSHOT_ID`.
 */

import { Daytona, Image } from '@daytona/sdk'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  IMMUTABLE_DAYTONA_SNAPSHOT_REF_ERROR,
  isImmutableDaytonaSnapshotRef,
} from '@sim/utils/sandbox-references'
import {
  FUNCTION_SANDBOX_CPU_COUNT,
  FUNCTION_SANDBOX_MEMORY_GB,
} from '@/lib/execution/remote-sandbox/function-resources'
import {
  FUNCTION_APT_PACKAGES,
  FUNCTION_COMMAND_ALIASES_ASSERT,
  FUNCTION_COMMAND_ALIASES_SETUP,
  FUNCTION_COMMANDS_ASSERT,
  FUNCTION_DAYTONA_BASE_IMAGE,
  FUNCTION_DAYTONA_NODE_INSTALL,
  FUNCTION_DAYTONA_NODE_VERSION,
  FUNCTION_DAYTONA_NODE_VERSION_ASSERT,
  FUNCTION_DAYTONA_PYTHON_VERSION,
  FUNCTION_NODE_VERSION_ASSERT,
  FUNCTION_NPM_CLI_PACKAGES,
  FUNCTION_NPM_CLI_VERSIONS_ASSERT,
  FUNCTION_PIP_CLI_PACKAGES,
  FUNCTION_PIP_CLI_VERSIONS_ASSERT,
  FUNCTION_PYTHON_IMPORTS_ASSERT,
  FUNCTION_PYTHON_VERSION_ASSERT,
} from '@/scripts/function-sandbox-packages'
import {
  createFunctionPythonVersionsAssert,
  type FunctionSandboxParityManifest,
  getPinnedFunctionPythonPackages,
  readFunctionSandboxParityManifest,
} from '@/scripts/function-sandbox-parity-manifest'

const logger = createLogger('BuildFunctionDaytonaSnapshot')
const APT_INSTALL = 'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends'
const RESOURCES = {
  cpu: FUNCTION_SANDBOX_CPU_COUNT,
  memory: FUNCTION_SANDBOX_MEMORY_GB,
  disk: 10,
} as const

export function createFunctionImage(manifest: FunctionSandboxParityManifest) {
  const pinnedPythonPackages = getPinnedFunctionPythonPackages(manifest)
  return Image.base(FUNCTION_DAYTONA_BASE_IMAGE).runCommands(
    `apt-get update && ${APT_INSTALL} ${FUNCTION_APT_PACKAGES.join(' ')} && rm -rf /var/lib/apt/lists/*`,
    FUNCTION_DAYTONA_NODE_INSTALL,
    `python3 -m pip install --no-cache-dir ${[...pinnedPythonPackages, ...FUNCTION_PIP_CLI_PACKAGES].join(' ')}`,
    `npm install -g ${FUNCTION_NPM_CLI_PACKAGES.join(' ')}`,
    FUNCTION_COMMAND_ALIASES_SETUP,
    'mkdir -p /workspace /opt/sim-deps',
    FUNCTION_NODE_VERSION_ASSERT,
    FUNCTION_DAYTONA_NODE_VERSION_ASSERT,
    FUNCTION_PYTHON_VERSION_ASSERT,
    FUNCTION_COMMANDS_ASSERT,
    FUNCTION_COMMAND_ALIASES_ASSERT,
    FUNCTION_PIP_CLI_VERSIONS_ASSERT,
    FUNCTION_NPM_CLI_VERSIONS_ASSERT,
    FUNCTION_PYTHON_IMPORTS_ASSERT,
    createFunctionPythonVersionsAssert(manifest)
  )
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const nameIndex = args.indexOf('--name')
  const snapshotName = nameIndex !== -1 ? args[nameIndex + 1] : process.env.DAYTONA_SNAPSHOT_NAME
  const manifestIndex = args.indexOf('--parity-manifest')
  const manifestPath =
    manifestIndex !== -1
      ? args[manifestIndex + 1]
      : process.env.FUNCTION_SANDBOX_PARITY_MANIFEST_PATH
  if (!snapshotName) {
    throw new Error('A snapshot name is required (--name <name> or DAYTONA_SNAPSHOT_NAME)')
  }
  if (!manifestPath) {
    throw new Error(
      'An accepted E2B parity manifest is required (--parity-manifest <path> or FUNCTION_SANDBOX_PARITY_MANIFEST_PATH)'
    )
  }
  if (!process.env.DAYTONA_API_KEY) {
    throw new Error('DAYTONA_API_KEY is required')
  }

  const manifest = readFunctionSandboxParityManifest(manifestPath)
  if (manifest.runtime.node !== FUNCTION_DAYTONA_NODE_VERSION) {
    throw new Error(
      `E2B parity manifest requires Node ${manifest.runtime.node}, but the Daytona bootstrap is pinned to ${FUNCTION_DAYTONA_NODE_VERSION}`
    )
  }
  if (manifest.runtime.python !== FUNCTION_DAYTONA_PYTHON_VERSION) {
    throw new Error(
      `E2B parity manifest requires Python ${manifest.runtime.python}, but the Daytona base is pinned to ${FUNCTION_DAYTONA_PYTHON_VERSION}`
    )
  }
  const functionImage = createFunctionImage(manifest)

  logger.info('Building Function Daytona snapshot', {
    snapshotName,
    baseImage: FUNCTION_DAYTONA_BASE_IMAGE,
    manifestPath,
    resources: RESOURCES,
  })

  const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY })
  const snapshot = await daytona.snapshot.create(
    { name: snapshotName, image: functionImage, resources: RESOURCES },
    {
      onLogs: (log: string) => {
        const message = log.trim()
        if (message) logger.info('Function Daytona snapshot build output', { message })
      },
    }
  )
  if (!isImmutableDaytonaSnapshotRef(snapshot.id)) {
    throw new Error(`Daytona returned a snapshot ID that ${IMMUTABLE_DAYTONA_SNAPSHOT_REF_ERROR}`)
  }

  logger.info('Built Function Daytona snapshot', {
    snapshotName,
    snapshotId: snapshot.id,
    configuration: `DAYTONA_FUNCTION_SNAPSHOT_ID=${snapshot.id}`,
  })
}

main().catch((error: unknown) => {
  logger.error('Function Daytona snapshot build failed', { error: getErrorMessage(error) })
  process.exitCode = 1
})
