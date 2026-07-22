#!/usr/bin/env bun

/**
 * Builds the E2B sandbox template used by Create PR and Review Code.
 *
 * Layers the `pi` CLI, its required Node version, and git onto E2B's
 * `code-interpreter` base. The cloud backend runs `pi` and git inside this
 * sandbox, so both must resolve on PATH.
 *
 * Usage:
 *   E2B_API_KEY=... bun run apps/sim/scripts/build-pi-e2b-template.ts [--name <name>] [--no-cache]
 *
 * After it builds, set the printed value in the Sim app's .env:
 *   E2B_PI_TEMPLATE_ID=<name>
 * `Sandbox.create` resolves by template name, so use the name (not the ID).
 */

import { defaultBuildLogger, Template, waitForTimeout } from '@e2b/code-interpreter'
import {
  PI_APT,
  PI_NODE_MAJOR,
  PI_NODE_VERSION_ASSERT,
  PI_NPM,
} from '@/scripts/pi-sandbox-packages'

const DEFAULT_TEMPLATE_NAME = 'sim-pi'

/** Pi 0.80 requires Node >=22.19; E2B's code-interpreter base currently ships Node 20. */
const INSTALL_NODE_COMMAND = `curl -fsSL https://deb.nodesource.com/setup_${PI_NODE_MAJOR}.x | bash - && apt-get install -y nodejs && ${PI_NODE_VERSION_ASSERT}`

/** Pi uses the command and filesystem APIs, so the inherited Jupyter service is unnecessary. */
const START_COMMAND = 'sleep infinity'

const piTemplate = Template()
  .fromTemplate('code-interpreter-v1')
  .runCmd(INSTALL_NODE_COMMAND, { user: 'root' })
  .aptInstall([...PI_APT])
  .npmInstall([...PI_NPM], { g: true })
  .setStartCmd(START_COMMAND, waitForTimeout(1_000))

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error('E2B_API_KEY is required')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const nameIdx = args.indexOf('--name')
  const templateName = nameIdx !== -1 ? args[nameIdx + 1] : DEFAULT_TEMPLATE_NAME
  const skipCache = args.includes('--no-cache')

  console.log(`Building Pi E2B template: ${templateName}`)
  console.log(skipCache ? 'Cache: disabled\n' : 'Cache: enabled\n')

  const result = await Template.build(piTemplate, templateName, {
    onBuildLogs: defaultBuildLogger(),
    ...(skipCache ? { skipCache: true } : {}),
  })

  console.log(`\nDone. Template ID: ${result.templateId}`)
  console.log(`Set in .env: E2B_PI_TEMPLATE_ID=${templateName}`)
}

main().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
