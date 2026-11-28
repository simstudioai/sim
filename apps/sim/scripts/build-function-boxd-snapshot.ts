#!/usr/bin/env bun

/**
 * Builds the boxd snapshot equivalent of the dedicated Function E2B base. It
 * boots a machine from boxd's Ubuntu image, installs the runtime and command
 * surface the Daytona builder renders from `function-sandbox-packages.ts`,
 * asserts it, and saves the machine as a snapshot.
 *
 * Usage:
 * `BOXD_API_KEY=... BOXD_REGION=nyc bun run apps/sim/scripts/build-function-boxd-snapshot.ts --name sim-function-<release> --parity-manifest /tmp/function-sandbox-manifest.json`
 *
 * Configure the printed `<snapshot-id>@<version>` ref as `BOXD_FUNCTION_SNAPSHOT`.
 * There is intentionally no fallback to `BOXD_SHELL_SNAPSHOT`.
 */

import { Boxd } from '@boxd-sh/sdk'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { immutableBoxdSnapshotRef } from '@sim/utils/sandbox-references'
import {
  FUNCTION_BOXD_MEMORY_GB,
  FUNCTION_SANDBOX_CPU_COUNT,
} from '@/lib/execution/remote-sandbox/function-resources'
import {
  FUNCTION_APT_PACKAGES,
  FUNCTION_COMMAND_ALIASES_ASSERT,
  FUNCTION_COMMAND_ALIASES_SETUP,
  FUNCTION_COMMANDS_ASSERT,
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

const logger = createLogger('BuildFunctionBoxdSnapshot')
const APT_INSTALL = 'DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends'
const PYTHON_STAGING_DIR = '/opt/sim-python-build'
const STEP_TIMEOUT_MS = 30 * 60 * 1000
const SNAPSHOT_READY_TIMEOUT_MS = 15 * 60 * 1000
/** boxd deletes the build machine after this long, should the builder die before it does. */
const BUILD_MACHINE_LIFETIME_SECONDS = 6 * 60 * 60

/**
 * The image's Ubuntu Python stays in place for the system. The Function
 * runtime is a relocatable CPython build laid into /usr/local, the prefix the
 * Daytona base image uses, so `python3`, `pip`, and console scripts installed
 * later all resolve from PATH.
 */
const FUNCTION_BOXD_PYTHON_INSTALL = [
  `uv python install ${FUNCTION_DAYTONA_PYTHON_VERSION} --install-dir ${PYTHON_STAGING_DIR} --no-bin`,
  `cp -a "$(dirname "$(dirname "$(UV_PYTHON_INSTALL_DIR=${PYTHON_STAGING_DIR} uv python find --managed-python ${FUNCTION_DAYTONA_PYTHON_VERSION})")")"/. /usr/local/`,
  `rm -rf ${PYTHON_STAGING_DIR} /usr/local/lib/python3.13/EXTERNALLY-MANAGED`,
  `test "$(command -v python3)" = /usr/local/bin/python3`,
].join(' && ')

function createFunctionBuildSteps(manifest: FunctionSandboxParityManifest): string[] {
  const pinnedPythonPackages = getPinnedFunctionPythonPackages(manifest)
  return [
    `apt-get update && ${APT_INSTALL} ${FUNCTION_APT_PACKAGES.join(' ')} && rm -rf /var/lib/apt/lists/*`,
    FUNCTION_BOXD_PYTHON_INSTALL,
    FUNCTION_DAYTONA_NODE_INSTALL,
    `python3 -m pip install --no-cache-dir ${[...pinnedPythonPackages, ...FUNCTION_PIP_CLI_PACKAGES].join(' ')}`,
    `npm install -g ${FUNCTION_NPM_CLI_PACKAGES.join(' ')}`,
    FUNCTION_COMMAND_ALIASES_SETUP,
    'mkdir -p /workspace /opt/sim-deps && chown boxd:boxd /workspace /opt/sim-deps',
    FUNCTION_NODE_VERSION_ASSERT,
    FUNCTION_DAYTONA_NODE_VERSION_ASSERT,
    FUNCTION_PYTHON_VERSION_ASSERT,
    FUNCTION_COMMANDS_ASSERT,
    FUNCTION_COMMAND_ALIASES_ASSERT,
    FUNCTION_PIP_CLI_VERSIONS_ASSERT,
    FUNCTION_NPM_CLI_VERSIONS_ASSERT,
    FUNCTION_PYTHON_IMPORTS_ASSERT,
    createFunctionPythonVersionsAssert(manifest),
  ]
}

/** Runs one build step as root and fails the build on a non-zero exit. */
async function runStep(boxd: Boxd, machineId: string, step: string, index: number) {
  const stream = boxd.machines.streamExec(machineId, {
    command: ['sudo', '-n', 'bash', '-c', `set -eo pipefail\n${step}`],
    closeStdin: true,
  })
  const log = async (source: AsyncIterable<Uint8Array>) => {
    const decoder = new TextDecoder()
    for await (const chunk of source) {
      const message = decoder.decode(chunk, { stream: true }).trim()
      if (message) logger.info('Function boxd snapshot build output', { step: index, message })
    }
  }
  const timer = setTimeout(() => stream.close(), STEP_TIMEOUT_MS)
  try {
    const [, , exitCode] = await Promise.all([
      log(stream.stdout),
      log(stream.stderr),
      stream.wait(),
    ])
    if (exitCode !== 0) {
      throw new Error(`Build step ${index} exited with code ${exitCode}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const nameIndex = args.indexOf('--name')
  const snapshotName = nameIndex !== -1 ? args[nameIndex + 1] : process.env.BOXD_SNAPSHOT_NAME
  const manifestIndex = args.indexOf('--parity-manifest')
  const manifestPath =
    manifestIndex !== -1
      ? args[manifestIndex + 1]
      : process.env.FUNCTION_SANDBOX_PARITY_MANIFEST_PATH
  if (!snapshotName) {
    throw new Error('A snapshot name is required (--name <name> or BOXD_SNAPSHOT_NAME)')
  }
  if (!manifestPath) {
    throw new Error(
      'An accepted E2B parity manifest is required (--parity-manifest <path> or FUNCTION_SANDBOX_PARITY_MANIFEST_PATH)'
    )
  }
  const apiKey = process.env.BOXD_API_KEY
  if (!apiKey) {
    throw new Error('BOXD_API_KEY is required')
  }

  const manifest = readFunctionSandboxParityManifest(manifestPath)
  if (manifest.runtime.node !== FUNCTION_DAYTONA_NODE_VERSION) {
    throw new Error(
      `E2B parity manifest requires Node ${manifest.runtime.node}, but the boxd bootstrap is pinned to ${FUNCTION_DAYTONA_NODE_VERSION}`
    )
  }
  if (manifest.runtime.python !== FUNCTION_DAYTONA_PYTHON_VERSION) {
    throw new Error(
      `E2B parity manifest requires Python ${manifest.runtime.python}, but the boxd bootstrap is pinned to ${FUNCTION_DAYTONA_PYTHON_VERSION}`
    )
  }
  const steps = createFunctionBuildSteps(manifest)
  const region = process.env.BOXD_REGION

  logger.info('Building Function boxd snapshot', { snapshotName, region, manifestPath })

  const boxd = new Boxd({ apiKey, ...(region ? { region } : {}) })
  const machine = await boxd.machines.create({
    name: `${snapshotName}-build`,
    ...(process.env.BOXD_ORG ? { org: process.env.BOXD_ORG } : {}),
    isolated: true,
    deleteAfter: BUILD_MACHINE_LIFETIME_SECONDS,
    config: {
      vcpu: FUNCTION_SANDBOX_CPU_COUNT,
      memory: `${FUNCTION_BOXD_MEMORY_GB}G`,
      autoSuspendTimeout: 0,
    },
  })
  logger.info('Started boxd build machine', { machineId: machine.id })
  try {
    await boxd.machines.waitUntilReady(machine.id, { timeout: 120_000 })
    for (const [index, step] of steps.entries()) {
      await runStep(boxd, machine.id, step, index)
    }

    const created = await boxd.snapshots.create(machine.id, snapshotName)
    const deadline = Date.now() + SNAPSHOT_READY_TIMEOUT_MS
    let snapshot = await boxd.snapshots.get(created.name)
    while (snapshot.status === 'pending' || (snapshot.version ?? 0) < created.version) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for the boxd snapshot')
      await sleep(2000)
      snapshot = await boxd.snapshots.get(created.name)
    }
    if (snapshot.status !== 'ready' || snapshot.version !== created.version) {
      throw new Error(`boxd snapshot ${created.name} ended as ${snapshot.status}`)
    }

    logger.info('Built Function boxd snapshot', {
      snapshotName,
      snapshotId: snapshot.id,
      configuration: `BOXD_FUNCTION_SNAPSHOT=${immutableBoxdSnapshotRef(snapshot.id, snapshot.version)}`,
    })
  } finally {
    await boxd.machines.delete(machine.id).catch((error: unknown) => {
      logger.warn('Failed to delete the boxd build machine', {
        machineId: machine.id,
        error: getErrorMessage(error),
      })
    })
  }
}

main().catch((error: unknown) => {
  logger.error('Function boxd snapshot build failed', { error: getErrorMessage(error) })
  process.exitCode = 1
})
