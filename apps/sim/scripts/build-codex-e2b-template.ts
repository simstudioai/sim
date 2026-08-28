#!/usr/bin/env bun

/** Builds the E2B template used by the Codex Coding Agent block. */

import { defaultBuildLogger, Template, waitForTimeout } from '@e2b/code-interpreter'
import {
  CODEX_APT,
  CODEX_BUN_VERSION_ASSERT,
  CODEX_CLI_VERSION_ASSERT,
  CODEX_GLOBAL_NPM_PACKAGES,
  CODEX_NODE_MAJOR,
  CODEX_NODE_VERSION_ASSERT,
  CODEX_SANDBOX_CPU_COUNT,
  CODEX_SANDBOX_MEMORY_MB,
} from '@/scripts/codex-sandbox-packages'

const DEFAULT_TEMPLATE_NAME = 'sim-codex'
const INSTALL_NODE_COMMAND = `curl -fsSL https://deb.nodesource.com/setup_${CODEX_NODE_MAJOR}.x | bash - && apt-get install -y nodejs && ${CODEX_NODE_VERSION_ASSERT}`

const codexTemplate = Template()
  .fromTemplate('code-interpreter-v1')
  .runCmd(INSTALL_NODE_COMMAND, { user: 'root' })
  .aptInstall([...CODEX_APT])
  .npmInstall([...CODEX_GLOBAL_NPM_PACKAGES], { g: true })
  .runCmd(`${CODEX_BUN_VERSION_ASSERT} && ${CODEX_CLI_VERSION_ASSERT}`, { user: 'root' })
  .setStartCmd('sleep infinity', waitForTimeout(1_000))

async function main() {
  if (!process.env.E2B_API_KEY) {
    console.error('E2B_API_KEY is required')
    process.exit(1)
  }

  const args = process.argv.slice(2)
  const nameIndex = args.indexOf('--name')
  const templateName = nameIndex === -1 ? DEFAULT_TEMPLATE_NAME : args[nameIndex + 1]
  const skipCache = args.includes('--no-cache')
  if (!templateName) throw new Error('--name requires a value')

  console.log(`Building Codex E2B template: ${templateName}`)
  const result = await Template.build(codexTemplate, templateName, {
    cpuCount: CODEX_SANDBOX_CPU_COUNT,
    memoryMB: CODEX_SANDBOX_MEMORY_MB,
    onBuildLogs: defaultBuildLogger(),
    ...(skipCache ? { skipCache: true } : {}),
  })
  console.log(`Done. Template ID: ${result.templateId}`)
  console.log(`Set in .env: E2B_CODEX_TEMPLATE_ID=${templateName}`)
}

main().catch((error) => {
  console.error('Build failed:', error)
  process.exit(1)
})
