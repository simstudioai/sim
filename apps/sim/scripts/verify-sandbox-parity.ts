#!/usr/bin/env bun

/**
 * Runs the real sandbox execution paths against whichever provider the
 * `SANDBOX_PROVIDER` env var selects, and prints a pass/fail matrix.
 *
 * This is the pre-switch confidence check: run it against E2B, run it against
 * Daytona, and compare. Every case exercises the shared layer end-to-end
 * (`executeInSandbox` / `executeShellInSandbox`) against a live sandbox — not
 * mocks — so it catches the failures unit tests cannot: a missing package, an
 * expired snapshot, an image that vanished during an org move, blocked egress.
 *
 * Usage:
 *   # E2B (default)
 *   E2B_FUNCTION_TEMPLATE_ID=<template>:<build-id> \
 *   E2B_FUNCTION_TEMPLATE_GENERATION=<release-epoch-ms> \
 *   SANDBOX_PARITY_MANIFEST_OUT=/tmp/function-sandbox-manifest.json \
 *     bun run apps/sim/scripts/verify-sandbox-parity.ts
 *
 *   # Daytona
 *   SANDBOX_PROVIDER=daytona \
 *   DAYTONA_FUNCTION_SNAPSHOT_ID=<snapshot-uuid> \
 *   DAYTONA_DOC_SNAPSHOT_ID=mothership-docs:<tag> \
 *   SANDBOX_PARITY_MANIFEST_BASELINE=/tmp/function-sandbox-manifest.json \
 *     bun run apps/sim/scripts/verify-sandbox-parity.ts
 *
 *   # Include the dependency-set cases (needs real workspace_sandbox rows):
 *   SANDBOX_PARITY_WORKSPACE_ID=... \
 *   SANDBOX_PARITY_PYTHON_SANDBOX_ID=...   # a Python sandbox declaring `pandas`
 *   SANDBOX_PARITY_JS_SANDBOX_ID=...       # a JavaScript sandbox declaring `axios`
 *
 * Exits non-zero if any case fails, so it can be wired to a schedule later.
 */

import { writeFile } from 'node:fs/promises'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox, executeShellInSandbox } from '@/lib/execution/remote-sandbox'
import {
  assertFunctionSandboxParityMatches,
  createFunctionSandboxParityProbe,
  type FunctionSandboxParityManifest,
  parseFunctionSandboxParityManifest,
  readFunctionSandboxParityManifest,
  serializeFunctionSandboxParityManifest,
} from '@/scripts/function-sandbox-parity-manifest'

const SIM_RESULT_PREFIX = '__SIM_RESULT__='
const logger = createLogger('VerifySandboxParity')

interface Case {
  name: string
  /** Skipped unless the doc image is configured for the active provider. */
  needsDoc?: boolean
  /**
   * Skipped unless `SANDBOX_PARITY_PYTHON_SANDBOX_ID` /
   * `SANDBOX_PARITY_JS_SANDBOX_ID` name a real workspace sandbox — resolving one
   * needs a DB row, so it cannot be synthesized here.
   */
  needsSandbox?: 'python' | 'javascript'
  run: () => Promise<{ ok: boolean; detail: string }>
}

/** A workspace + sandbox to resolve the dependency-set cases against. */
const PARITY_WORKSPACE_ID = process.env.SANDBOX_PARITY_WORKSPACE_ID
const PARITY_PYTHON_SANDBOX_ID = process.env.SANDBOX_PARITY_PYTHON_SANDBOX_ID
const PARITY_JS_SANDBOX_ID = process.env.SANDBOX_PARITY_JS_SANDBOX_ID

interface ManifestState {
  expected?: FunctionSandboxParityManifest
  actual?: FunctionSandboxParityManifest
}

function createCases(manifestState: ManifestState): Case[] {
  return [
    {
      name: 'shell: deterministic Function base manifest',
      run: async () => {
        const res = await executeShellInSandbox({
          code: createFunctionSandboxParityProbe(SIM_RESULT_PREFIX),
          envs: {},
          timeoutMs: 300_000,
        })
        if (res.error) return { ok: false, detail: res.error }
        const actual = parseFunctionSandboxParityManifest(res.result)
        if (manifestState.expected) {
          assertFunctionSandboxParityMatches(manifestState.expected, actual)
        }
        manifestState.actual = actual
        return {
          ok: true,
          detail: `manifest=${JSON.stringify(actual)}`,
        }
      },
    },
    {
      name: 'python: result marker round-trip',
      run: async () => {
        const res = await executeInSandbox({
          code: `import json\nprint("stdout-line")\nprint("${SIM_RESULT_PREFIX}" + json.dumps({"n": 42}))`,
          language: CodeLanguage.Python,
          timeoutMs: 120_000,
        })
        const value = (res.result as { n?: number } | null)?.n
        return {
          ok: value === 42 && res.stdout.includes('stdout-line') && !res.error,
          detail: `result=${JSON.stringify(res.result)} stdout=${JSON.stringify(res.stdout)}`,
        }
      },
    },
    {
      name: 'python: structured error (name/value/traceback)',
      run: async () => {
        const res = await executeInSandbox({
          code: 'raise ValueError("boom")',
          language: CodeLanguage.Python,
          timeoutMs: 120_000,
        })
        return {
          ok: res.error === 'ValueError: boom' && res.result === null,
          detail: `error=${JSON.stringify(res.error)}`,
        }
      },
    },
    {
      name: 'python: outbound network (egress parity)',
      run: async () => {
        const res = await executeInSandbox({
          code: `import json, urllib.request\ncode = urllib.request.urlopen("https://example.com", timeout=20).status\nprint("${SIM_RESULT_PREFIX}" + json.dumps({"status": code}))`,
          language: CodeLanguage.Python,
          timeoutMs: 120_000,
        })
        const status = (res.result as { status?: number } | null)?.status
        return { ok: status === 200, detail: res.error ?? `status=${status}` }
      },
    },
    {
      name: 'javascript: imports run under node',
      run: async () => {
        const res = await executeInSandbox({
          code: `const os = require('os')\nconsole.log('${SIM_RESULT_PREFIX}' + JSON.stringify({ platform: os.platform() }))`,
          language: CodeLanguage.JavaScript,
          timeoutMs: 120_000,
        })
        const platform = (res.result as { platform?: string } | null)?.platform
        return { ok: platform === 'linux', detail: res.error ?? `platform=${platform}` }
      },
    },
    /** The same selection must import under prebuilt E2B and runtime Daytona provisioning. */
    {
      name: 'python: a selected sandbox makes its packages importable',
      needsSandbox: 'python',
      run: async () => {
        const res = await executeInSandbox({
          code: `import json, pandas\nprint("${SIM_RESULT_PREFIX}" + json.dumps({"v": pandas.__version__}))`,
          language: CodeLanguage.Python,
          timeoutMs: 300_000,
          workspaceId: PARITY_WORKSPACE_ID,
          sandboxId: PARITY_PYTHON_SANDBOX_ID,
        })
        const version = (res.result as { v?: string } | null)?.v
        return { ok: Boolean(version), detail: res.error ?? `pandas=${version}` }
      },
    },
    {
      name: 'javascript: a selected sandbox resolves its packages',
      needsSandbox: 'javascript',
      run: async () => {
        const res = await executeInSandbox({
          code: `const axios = require('axios')\nconsole.log('${SIM_RESULT_PREFIX}' + JSON.stringify({ ok: typeof axios.get === 'function' }))`,
          language: CodeLanguage.JavaScript,
          timeoutMs: 300_000,
          workspaceId: PARITY_WORKSPACE_ID,
          sandboxId: PARITY_JS_SANDBOX_ID,
        })
        const ok = (res.result as { ok?: boolean } | null)?.ok
        return { ok: ok === true, detail: res.error ?? `resolved=${ok}` }
      },
    },
    {
      name: 'shell: env vars + user-authored marker',
      run: async () => {
        const res = await executeShellInSandbox({
          code: `echo "${SIM_RESULT_PREFIX}$MY_VAR"`,
          envs: { MY_VAR: 'from-env' },
          timeoutMs: 120_000,
        })
        return { ok: res.result === 'from-env', detail: `result=${JSON.stringify(res.result)}` }
      },
    },
    {
      name: 'mount: inline file in, text file out',
      run: async () => {
        const res = await executeInSandbox({
          code: `data = open("/tmp/in.txt").read().strip()\nopen("/tmp/out.txt", "w").write(data.upper())\nprint("${SIM_RESULT_PREFIX}null")`,
          language: CodeLanguage.Python,
          timeoutMs: 120_000,
          sandboxFiles: [{ path: '/tmp/in.txt', content: 'mounted' }],
          outputSandboxPath: '/tmp/out.txt',
        })
        return {
          ok: res.exportedFileContent?.trim() === 'MOUNTED',
          detail: res.error ?? `exported=${JSON.stringify(res.exportedFileContent)}`,
        }
      },
    },
    {
      name: 'doc: xlsx compile + base64 binary export',
      needsDoc: true,
      run: async () => {
        const res = await executeInSandbox({
          code: `import openpyxl\nwb = openpyxl.Workbook(); ws = wb.active\nws["A1"] = 5; ws["A2"] = 7; ws["A3"] = "=A1+A2"\nwb.save("/tmp/out.xlsx")\nprint("${SIM_RESULT_PREFIX}null")`,
          language: CodeLanguage.Python,
          timeoutMs: 180_000,
          sandboxKind: 'doc',
          outputSandboxPath: '/tmp/out.xlsx',
        })
        const b64 = res.exportedFileContent ?? ''
        const hasZipHeader = b64.startsWith('UEsD')
        return {
          ok: hasZipHeader && b64.length > 1000,
          detail: res.error ?? `base64Len=${b64.length} head=${b64.slice(0, 8)}`,
        }
      },
    },
  ]
}

async function main(): Promise<void> {
  const provider = process.env.SANDBOX_PROVIDER || 'e2b'
  const baselinePath = process.env.SANDBOX_PARITY_MANIFEST_BASELINE
  const outputPath = process.env.SANDBOX_PARITY_MANIFEST_OUT
  if (provider === 'daytona' && !baselinePath) {
    throw new Error('SANDBOX_PARITY_MANIFEST_BASELINE is required for Daytona parity verification')
  }
  if (provider !== 'e2b' && outputPath) {
    throw new Error('Only the E2B Function base may produce SANDBOX_PARITY_MANIFEST_OUT')
  }

  const manifestState: ManifestState = {
    expected: baselinePath ? readFunctionSandboxParityManifest(baselinePath) : undefined,
  }
  const cases = createCases(manifestState)
  const docConfigured =
    provider === 'daytona'
      ? Boolean(process.env.DAYTONA_DOC_SNAPSHOT_ID)
      : Boolean(process.env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID)

  logger.info('Starting sandbox parity verification', {
    provider,
    baselinePath,
    outputPath,
  })

  let failed = 0
  let skipped = 0
  for (const testCase of cases) {
    if (testCase.needsDoc && !docConfigured) {
      logger.info('Skipping sandbox parity case', {
        case: testCase.name,
        reason: 'doc image not configured',
      })
      skipped++
      continue
    }
    const sandboxId =
      testCase.needsSandbox === 'python' ? PARITY_PYTHON_SANDBOX_ID : PARITY_JS_SANDBOX_ID
    if (testCase.needsSandbox && !(PARITY_WORKSPACE_ID && sandboxId)) {
      logger.info('Skipping sandbox parity case', {
        case: testCase.name,
        reason: `no ${testCase.needsSandbox} sandbox configured`,
      })
      skipped++
      continue
    }
    const started = Date.now()
    try {
      const { ok, detail } = await testCase.run()
      const durationMs = Date.now() - started
      if (!ok) {
        logger.error('Sandbox parity case failed', {
          case: testCase.name,
          durationMs,
          detail,
        })
        failed++
      } else {
        logger.info('Sandbox parity case passed', { case: testCase.name, durationMs })
      }
    } catch (error) {
      logger.error('Sandbox parity case failed', {
        case: testCase.name,
        error: getErrorMessage(error),
      })
      failed++
    }
  }

  const passed = cases.length - failed - skipped
  if (failed > 0) {
    logger.error('Sandbox parity verification failed', { provider, passed, failed, skipped })
    process.exitCode = 1
    return
  }

  if (outputPath) {
    if (!manifestState.actual) {
      throw new Error('Function sandbox manifest probe did not return a manifest')
    }
    await writeFile(
      outputPath,
      serializeFunctionSandboxParityManifest(manifestState.actual),
      'utf8'
    )
    logger.info('Wrote accepted E2B Function sandbox manifest', { outputPath })
  }
  logger.info('Sandbox parity verification passed', { provider, passed, failed, skipped })
}

main().catch((error: unknown) => {
  logger.error('Sandbox parity harness failed', { error: getErrorMessage(error) })
  process.exitCode = 1
})
