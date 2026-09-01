#!/usr/bin/env bun

/**
 * Builds the dedicated E2B base used by Function JavaScript, Python, Shell, and
 * content-addressed workspace sandbox layers.
 *
 * Usage:
 * `E2B_API_KEY=... bun run apps/sim/scripts/build-function-e2b-template.ts [--name <name>] [--generation <monotonic-release-number>] [--base-template <name:build-id>] [--no-cache]`
 *
 * Configure the resulting exact build ref as `E2B_FUNCTION_TEMPLATE_ID`. There is
 * intentionally no fallback to `MOTHERSHIP_E2B_TEMPLATE_ID`: the two images have
 * independent owners and release cadences.
 *
 * Revisioned materializer tasks deploy alongside legacy and previous-revision
 * bridges. Trigger.dev keeps a run waiting when its new task ID has not deployed
 * yet, so either promotion order preserves the registry claim.
 */

import { defaultBuildLogger, Template, waitForTimeout } from '@e2b/code-interpreter'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { immutableE2BTemplateRef, isValidE2BTemplateName } from '@sim/utils/sandbox-references'
import {
  FUNCTION_SANDBOX_CPU_COUNT,
  FUNCTION_SANDBOX_MEMORY_MB,
} from '@/lib/execution/remote-sandbox/function-resources'
import {
  functionE2BBaseTemplate,
  functionE2BReleaseGeneration,
} from '@/scripts/function-e2b-release'
import {
  FUNCTION_APT_PACKAGES,
  FUNCTION_COMMAND_ALIASES_ASSERT,
  FUNCTION_COMMAND_ALIASES_SETUP,
  FUNCTION_COMMANDS_ASSERT,
  FUNCTION_E2B_PYTHON_PACKAGES,
  FUNCTION_NODE_VERSION_ASSERT,
  FUNCTION_NPM_CLI_PACKAGES,
  FUNCTION_NPM_CLI_VERSIONS_ASSERT,
  FUNCTION_PIP_CLI_PACKAGES,
  FUNCTION_PIP_CLI_VERSIONS_ASSERT,
  FUNCTION_PYTHON_IMPORTS_ASSERT,
  FUNCTION_PYTHON_VERSION_ASSERT,
} from '@/scripts/function-sandbox-packages'

const logger = createLogger('BuildFunctionE2BTemplate')
const DEFAULT_TEMPLATE_NAME = 'sim-function'
const START_COMMAND = 'sleep infinity'

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    throw new Error('E2B_API_KEY is required')
  }

  const args = process.argv.slice(2)
  const baseTemplate = functionE2BBaseTemplate(args)
  const nameIndex = args.indexOf('--name')
  const templateName = nameIndex !== -1 ? args[nameIndex + 1] : DEFAULT_TEMPLATE_NAME
  if (!templateName) throw new Error('--name requires a template name')
  if (!isValidE2BTemplateName(templateName)) {
    throw new Error('--name must be an untagged E2B template name')
  }
  const releaseGeneration = functionE2BReleaseGeneration(
    args,
    process.env.E2B_FUNCTION_TEMPLATE_GENERATION
  )
  const skipCache = args.includes('--no-cache')

  const functionTemplate = Template()
    .fromTemplate(baseTemplate)
    .aptInstall([...FUNCTION_APT_PACKAGES])
    .pipInstall([...FUNCTION_E2B_PYTHON_PACKAGES, ...FUNCTION_PIP_CLI_PACKAGES])
    .npmInstall([...FUNCTION_NPM_CLI_PACKAGES], { g: true })
    .runCmd(FUNCTION_COMMAND_ALIASES_SETUP, { user: 'root' })
    .runCmd(FUNCTION_NODE_VERSION_ASSERT, { user: 'root' })
    .runCmd(FUNCTION_PYTHON_VERSION_ASSERT, { user: 'root' })
    .runCmd(FUNCTION_COMMANDS_ASSERT, { user: 'root' })
    .runCmd(FUNCTION_COMMAND_ALIASES_ASSERT, { user: 'root' })
    .runCmd(FUNCTION_PIP_CLI_VERSIONS_ASSERT, { user: 'root' })
    .runCmd(FUNCTION_NPM_CLI_VERSIONS_ASSERT, { user: 'root' })
    .runCmd(FUNCTION_PYTHON_IMPORTS_ASSERT, { user: 'root' })
    .setStartCmd(START_COMMAND, waitForTimeout(1_000))

  logger.info('Building Function E2B template', {
    templateName,
    baseTemplate,
    cpuCount: FUNCTION_SANDBOX_CPU_COUNT,
    memoryMB: FUNCTION_SANDBOX_MEMORY_MB,
    releaseGeneration,
    skipCache,
  })

  const result = await Template.build(functionTemplate, templateName, {
    cpuCount: FUNCTION_SANDBOX_CPU_COUNT,
    memoryMB: FUNCTION_SANDBOX_MEMORY_MB,
    onBuildLogs: defaultBuildLogger(),
    ...(skipCache ? { skipCache: true } : {}),
  })
  const immutableRef = immutableE2BTemplateRef(result.name, result.buildId)

  logger.info('Built Function E2B template', {
    templateName,
    templateId: result.templateId,
    buildId: result.buildId,
    configuration: `E2B_FUNCTION_TEMPLATE_ID=${immutableRef}`,
    releaseGeneration,
    generationConfiguration: `E2B_FUNCTION_TEMPLATE_GENERATION=${releaseGeneration}`,
  })
}

main().catch((error: unknown) => {
  logger.error('Function E2B template build failed', { error: getErrorMessage(error) })
  process.exitCode = 1
})
