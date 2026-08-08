/**
 * @vitest-environment node
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { hasPython3, PYTHON_SKIP_REASON } from '@sim/testing/environment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import {
  sandboxCliEnvironment,
  sandboxCliToolRecipes,
} from '@/lib/execution/remote-sandbox/cli-tools.server'
import { provisionRuntimeDependencies } from '@/lib/execution/remote-sandbox/resolve'
import {
  hashSandboxSpec,
  SIM_REQUIREMENTS_PATH,
  validateDependencies,
} from '@/lib/execution/remote-sandbox/sandbox-spec'
import type { SandboxCommandResult, SandboxHandle } from '@/lib/execution/remote-sandbox/types'

const CLI_TOOL_ID = 'google-cloud-cli@577.0.0-r1' as const
const FIXTURE_DIR = resolve(process.cwd(), 'lib/execution/remote-sandbox/fixtures')
const FIXTURE_PATH = join(FIXTURE_DIR, 'fellows-council-weekly.py')
const HARNESS_PATH = join(FIXTURE_DIR, 'run-fellows-council-weekly.py')
const tempRoots: string[] = []

const FELLOWS_SANDBOX_SPEC = {
  language: CodeLanguage.Python,
  dependencies: ['requests', 'anthropic'],
  cliTools: [CLI_TOOL_ID],
  systemPackages: [],
} as const

interface HarnessOutput {
  credentialMaterialized: boolean
  entries: string[]
  zipPath: string
}

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'sim-fellows-fixture-'))
  tempRoots.push(root)
  return root
}

function runFixture(root: string): HarnessOutput {
  const outputDir = join(root, 'output')
  const zipPath = join(root, 'fellows-previews.zip')
  const stdout = execFileSync('python3', [HARNESS_PATH, FIXTURE_PATH, outputDir, zipPath], {
    encoding: 'utf8',
  })
  const resultLine = stdout
    .trim()
    .split('\n')
    .findLast((line) => line.startsWith('{'))
  if (!resultLine) throw new Error('Fellows fixture harness did not report its outputs')
  return JSON.parse(resultLine) as HarnessOutput
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('Fellows Council Weekly sandbox acceptance fixture', () => {
  it('preserves the supplied module, dependency, CLI, credential, and cloud-output flows', () => {
    const source = readFileSync(FIXTURE_PATH, 'utf8')

    expect(source.split('\n').length).toBeGreaterThan(3_000)
    expect(source).toContain('import requests')
    expect(source).toContain('import anthropic')
    expect(source).toContain("['bq', 'query'")
    expect(source).toContain('{{ANTHROPIC_API_KEY}}')
    expect(source).toContain('{{NCBI_API_KEY}}')
    expect(source).toContain('{{AIRTABLE_PAT}}')
    expect(source).toContain('{{GOOGLE_SERVICE_ACCOUNT_JSON}}')
    expect(source).toContain("os.environ['GOOGLE_APPLICATION_CREDENTIALS']")
    expect(source).toContain("OUT_DIR = '/tmp/fellows-council-weekly'")
    expect(source).toContain("EXPORT_ZIP = '/tmp/fellows-previews.zip'")
    expect(source).toContain('write_deterministic_export(artifacts)')
    expect(source).toContain('cleanup_google_credentials(credential_path)')
    expect(source).toContain("if __name__ == '__main__':")
    expect(source).not.toContain('/Users/')
    expect(source).not.toContain('carespace-vpc-host-prod')
    expect(source).not.toContain('appzPcoBRgsmUX2r0')
    expect(source).not.toContain('tblbyncEqOPXpR7QI')
    expect(source).not.toContain('roon_public_prod')
    expect(source).not.toContain('doctor_public')
  })

  it('models the selected Python sandbox with requests, anthropic, bq, and propagated PATH', async () => {
    const validation = validateDependencies(
      FELLOWS_SANDBOX_SPEC.language,
      FELLOWS_SANDBOX_SPEC.dependencies
    )
    expect(validation).toEqual({ ok: true, dependencies: ['anthropic', 'requests'] })

    const cliEnvironment = sandboxCliEnvironment(FELLOWS_SANDBOX_SPEC.cliTools)
    const [recipe] = sandboxCliToolRecipes(FELLOWS_SANDBOX_SPEC.cliTools)
    expect(cliEnvironment.PATH).toContain('/opt/sim-cli/google-cloud-cli/google-cloud-sdk/bin')
    expect(recipe.executables).toEqual(['gcloud', 'bq', 'gsutil'])
    expect(
      hashSandboxSpec({
        language: FELLOWS_SANDBOX_SPEC.language,
        dependencies: [...FELLOWS_SANDBOX_SPEC.dependencies],
        cliTools: [...FELLOWS_SANDBOX_SPEC.cliTools],
        systemPackages: [],
      })
    ).toMatch(/^[0-9a-f]{64}$/)

    const commands: Array<{ command: string; envs?: Record<string, string> }> = []
    const files = new Map<string, string>()
    const success: SandboxCommandResult = { stdout: '', stderr: '', exitCode: 0 }
    const handle: SandboxHandle = {
      sandboxId: 'fellows-runtime-sandbox',
      runCode: vi.fn(),
      runCommand: vi.fn(async (command, options) => {
        commands.push({ command, envs: options.envs })
        return success
      }),
      getFileSize: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(async (path, content) => {
        files.set(path, String(content))
      }),
      kill: vi.fn(),
    }

    await provisionRuntimeDependencies(
      handle,
      {
        id: 'fellows-sandbox',
        name: 'Fellows digest',
        language: CodeLanguage.Python,
        dependencies: [...FELLOWS_SANDBOX_SPEC.dependencies],
        cliTools: [...FELLOWS_SANDBOX_SPEC.cliTools],
        systemPackages: [],
        specHash: 'fixture-spec-hash',
        strategy: 'runtime',
        envs: cliEnvironment,
      },
      { timeoutMs: 10 * 60_000 }
    )

    expect(files.get(SIM_REQUIREMENTS_PATH)).toBe('anthropic\nrequests\n')
    expect(commands.some(({ command }) => command.includes('google-cloud-cli-577.0.0'))).toBe(true)
    expect(commands.some(({ command }) => command.includes('bq version'))).toBe(true)
    expect(commands.some(({ command }) => command.startsWith('pip install'))).toBe(true)
    expect(commands.find(({ command }) => command.includes('bq version'))?.command).toContain(
      `export PATH='${cliEnvironment.PATH}'`
    )
  })

  it('stubs every external service and exports deterministic HTML and JSON in a ZIP', (ctx) => {
    if (!hasPython3()) ctx.skip(PYTHON_SKIP_REASON)
    const firstRoot = makeTempRoot()
    const secondRoot = makeTempRoot()
    const first = runFixture(firstRoot)
    const second = runFixture(secondRoot)

    expect(first.entries).toEqual([
      'fellows_weekly_ada_example.html',
      'fellows_weekly_index.html',
      'fellows_weekly_meta.json',
    ])
    expect(second.entries).toEqual(first.entries)
    expect(first.credentialMaterialized).toBe(true)
    expect(second.credentialMaterialized).toBe(true)
    expect(sha256(first.zipPath)).toBe(sha256(second.zipPath))
    expect(readFileSync(first.zipPath).includes(Buffer.from('google-service-account.json'))).toBe(
      false
    )
    expect(() =>
      readFileSync(join(firstRoot, 'output', '.runtime', 'google-service-account.json'))
    ).toThrow()

    const memberHtml = readFileSync(
      join(firstRoot, 'output', 'fellows_weekly_ada_example.html'),
      'utf8'
    )
    const metadata = JSON.parse(
      readFileSync(join(firstRoot, 'output', 'fellows_weekly_meta.json'), 'utf8')
    ) as { generated_at: string; fellows: Record<string, unknown> }
    const zipBytes = readFileSync(first.zipPath)

    expect(memberHtml).toContain('Fellows Council Weekly')
    expect(memberHtml).toContain('Dr. Example')
    expect(metadata.generated_at).toBe('2026-08-03T12:00:00+00:00')
    expect(metadata.fellows).toHaveProperty('ada_example')
    expect(metadata.fellows.ada_example).toMatchObject({ first: 'Ada', last: 'Example' })
    for (const entry of first.entries) {
      expect(zipBytes.includes(Buffer.from(entry))).toBe(true)
    }
  })
})
