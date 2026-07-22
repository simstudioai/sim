#!/usr/bin/env bun

/**
 * Runs the real sandbox execution paths against whichever provider the
 * `sandbox-provider-daytona` flag currently selects, and prints a pass/fail
 * matrix.
 *
 * This is the pre-flip confidence check: run it against E2B, run it against
 * Daytona, and compare. Every case exercises the shared layer end-to-end
 * (`executeInSandbox` / `executeShellInSandbox`) against a live sandbox — not
 * mocks — so it catches the failures unit tests cannot: a missing package, an
 * expired snapshot, an image that vanished during an org move, blocked egress.
 *
 * Usage:
 *   # E2B (flag off)
 *   bun run apps/sim/scripts/verify-sandbox-parity.ts
 *
 *   # Daytona (flag on via its env fallback)
 *   SANDBOX_PROVIDER_DAYTONA=true \
 *   DAYTONA_SHELL_SNAPSHOT_ID=mothership-shell:<tag> \
 *   DAYTONA_DOC_SNAPSHOT_ID=mothership-docs:<tag> \
 *     bun run apps/sim/scripts/verify-sandbox-parity.ts
 *
 * Exits non-zero if any case fails, so it can be wired to a schedule later.
 */

import { CodeLanguage } from '@/lib/execution/languages'
import { executeInSandbox, executeShellInSandbox } from '@/lib/execution/remote-sandbox'

const SIM_RESULT_PREFIX = '__SIM_RESULT__='

interface Case {
  name: string
  /** Skipped unless the doc image is configured for the active provider. */
  needsDoc?: boolean
  run: () => Promise<{ ok: boolean; detail: string }>
}

const CASES: Case[] = [
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
    name: 'python: data-science imports (base parity)',
    run: async () => {
      const res = await executeInSandbox({
        code: `import numpy, pandas, requests, bs4, openpyxl\nimport json\nprint("${SIM_RESULT_PREFIX}" + json.dumps({"numpy": numpy.__version__}))`,
        language: CodeLanguage.Python,
        timeoutMs: 180_000,
      })
      return {
        ok: !res.error && Boolean((res.result as { numpy?: string } | null)?.numpy),
        detail: res.error ?? `numpy=${(res.result as { numpy?: string } | null)?.numpy}`,
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
      // xlsx is a ZIP: base64 of a PK.. header always starts UEsD.
      return {
        ok: b64.startsWith('UEsD') && b64.length > 1000,
        detail: res.error ?? `base64Len=${b64.length} head=${b64.slice(0, 8)}`,
      }
    },
  },
]

async function main() {
  const provider = process.env.SANDBOX_PROVIDER_DAYTONA ? 'daytona' : 'e2b'
  const docConfigured =
    provider === 'daytona'
      ? Boolean(process.env.DAYTONA_DOC_SNAPSHOT_ID)
      : Boolean(process.env.MOTHERSHIP_E2B_DOC_TEMPLATE_ID)

  console.log(`\nsandbox parity — provider: ${provider}\n${'='.repeat(50)}`)

  let failed = 0
  let skipped = 0
  for (const testCase of CASES) {
    if (testCase.needsDoc && !docConfigured) {
      console.log(`SKIP  ${testCase.name} (doc image not configured)`)
      skipped++
      continue
    }
    const started = Date.now()
    try {
      const { ok, detail } = await testCase.run()
      const seconds = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${testCase.name}  (${seconds}s)`)
      if (!ok) {
        console.log(`      ${detail}`)
        failed++
      }
    } catch (error) {
      console.log(`FAIL  ${testCase.name}`)
      console.log(`      threw: ${error instanceof Error ? error.message : String(error)}`)
      failed++
    }
  }

  const passed = CASES.length - failed - skipped
  console.log(
    `${'='.repeat(50)}\n${provider}: ${passed} passed, ${failed} failed, ${skipped} skipped\n`
  )
  if (failed > 0) process.exit(1)
}

main().catch((error: unknown) => {
  console.error('harness error:', error instanceof Error ? error.message : error)
  process.exit(1)
})
