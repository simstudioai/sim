#!/usr/bin/env bun

/**
 * Builds the E2B sandbox template that powers the Pi Coding Agent cloud mode.
 *
 * Layers the `pi` CLI plus git onto E2B's `code-interpreter` base (which already
 * ships node + python). The cloud backend runs `pi` and `git clone/commit/push`
 * inside this sandbox, so both must resolve on PATH — the global npm bin and
 * `/usr/bin` both are.
 *
 * Usage:
 *   E2B_API_KEY=... bun run apps/sim/scripts/build-pi-e2b-template.ts [--name <name>] [--no-cache]
 *
 * After it builds, set the printed value in the Sim app's .env:
 *   E2B_PI_TEMPLATE_ID=<name>
 * `Sandbox.create` resolves by template name, so use the name (not the ID).
 */

import { defaultBuildLogger, Template } from '@e2b/code-interpreter'

const DEFAULT_TEMPLATE_NAME = 'sim-pi'
const PI_CODING_AGENT_PACKAGE = '@earendil-works/pi-coding-agent@0.79.4'

const piTemplate = Template()
  .fromTemplate('code-interpreter-v1')
  // git (+ ssh/certs) for clone/commit/push; ripgrep/fd give the agent fast
  // file search from its bash tool; gh enables richer GitHub workflows.
  .aptInstall(['git', 'gh', 'openssh-client', 'ca-certificates', 'ripgrep', 'fd-find'])
  // The `pi` CLI the cloud backend invokes.
  .npmInstall([PI_CODING_AGENT_PACKAGE], { g: true })

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
