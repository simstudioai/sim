import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import {
  CodePlaceholderCompileError,
  type CompiledCodePlaceholders,
  compileCodePlaceholders,
} from '@/lib/execution/code-placeholders'
import { CodeLanguage } from '@/lib/execution/languages'

/**
 * Exercises the compiler's environment bindings and private inputs in real Bash.
 * Run from apps/sim with SHELL_PLACEHOLDERS_REPORT_PATH and optionally SHELL_PLACEHOLDERS_BASH.
 * This covers compilation through process execution, not the hosted sandbox transport.
 */
const logger = createLogger('ShellPlaceholdersE2E')
const reportPath = process.env.SHELL_PLACEHOLDERS_REPORT_PATH
assert(reportPath, 'Set SHELL_PLACEHOLDERS_REPORT_PATH')
const bash = process.env.SHELL_PLACEHOLDERS_BASH ?? '/bin/bash'
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const directory = mkdtempSync(join(tmpdir(), 'sim-shell-placeholders-'))
const sentinel = join(directory, 'sentinel')
const payload = `values[$(touch '${sentinel}')]`

function execute(compiled: CompiledCodePlaceholders): string {
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', PATH: process.env.PATH ?? '/usr/bin:/bin' }
  for (const binding of compiled.bindings) env[binding.name] = binding.value
  for (const [index, input] of compiled.privateInputs.entries()) {
    const path = join(directory, `input-${index}`)
    writeFileSync(path, input.content, { mode: 0o600 })
    env[input.environmentVariable] = path
  }
  const result = spawnSync(bash, ['--noprofile', '--norc', '-c', compiled.code], {
    env,
    cwd: directory,
    encoding: 'utf8',
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
  })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

async function check(name: string, run: () => Promise<void>): Promise<void> {
  const start = performance.now()
  rmSync(sentinel, { force: true })
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: performance.now() - start })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
  }
}

async function compile(code: string, value: string): Promise<CompiledCodePlaceholders> {
  return compileCodePlaceholders({ code, language: CodeLanguage.Shell, params: { KEY: value } })
}

try {
  const arithmetic = [
    '[[ "{{KEY}}" \\\n  -eq 0 ]]',
    '[[ \\\n  "{{KEY}}" -eq 0 ]]',
    'time -p [[ "{{KEY}}" -eq 0 ]]',
    'coproc [[ "{{KEY}}" -eq 0 ]]; wait',
    'coproc worker [[ "{{KEY}}" -eq 0 ]]; wait',
    'coproc "worker" [[ "{{KEY}}" -eq 0 ]]; wait',
    'coproc "$(printf worker)" [[ "{{KEY}}" -eq 0 ]]; wait',
    'if \\\n [[ "{{KEY}}" -eq 0 ]]; then :; fi',
    '[\\\n[ "{{KEY}}" -eq 0 ]]',
    '[[ "{{KEY}}" -e\\\nq 0 ]]',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion
    '[[ ${missing:- {{KEY}}} -eq 0 ]]',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion
    '[[ ${missing:-"${other:- {{KEY}}}"} -eq 0 ]]',

    '[[ "{{KEY}}" -eq 0 ]]',
    '[[ 0 -lt "{{KEY}}" ]]',
    'echo ignored >/dev/null # end command\n[[ "{{KEY}}" -eq 0 ]]',
    'case x in x) [[ "{{KEY}}" -eq 0 ]];; esac',
    '[[ $(printf %s "{{KEY}}")+0 -eq 0 ]]',
    '[[ $(printf "%s" "{{KEY}}") -ge 0 ]]',
    '[[ $(printf "%s" "{{KEY}}"; :) -ne 1 ]]',
    '[[ $(cat <<EOF\n{{KEY}}\nEOF\n) -ge 0 ]]',
    "[[ $(cat <<'EOF'\n{{KEY}}\nEOF\n) -le 0 ]]",
    'echo $(( $(cat <<EOF\n{{KEY}}\nEOF\n) + 1 ))',
    "echo $(( $(cat <<'EOF'\n{{KEY}}\nEOF\n) + 1 ))",
    "echo $(( $(cat <<-'EOF'\n\t{{KEY}}\n\tEOF\n) + 1 ))",
  ]
  for (const code of ['[[ "{{KEY}}" -eq 0 ]]', 'echo $(( $(cat <<EOF\n{{KEY}}\nEOF\n) + 1 ))']) {
    await check(`unsafe control: ${code}`, async () => {
      const binding = '__probe_value'
      execute({
        code: code.replaceAll('{{KEY}}', `\${${binding}}`),
        bindings: [{ name: binding, value: payload }],
        privateInputs: [],
        runtimeBindings: [],
        resolvedSecretNames: [],
        internalIdentifiers: [],
      })
      assert(existsSync(sentinel), 'The unprotected expression must execute the sentinel')
    })
  }
  for (const code of arithmetic) {
    await check(`rejects arithmetic: ${code}`, async () => {
      await assert.rejects(
        () => compile(code, payload),
        (error: unknown) =>
          error instanceof CodePlaceholderCompileError &&
          error.message.includes('in shell arithmetic')
      )
      assert(!existsSync(sentinel))
    })
  }

  for (const value of ['["$5"]', '[WIP', "[don't]", payload, 'a[', '$(printf injected)']) {
    for (const code of [
      'printf "%s\\n" "{{KEY}}"',
      "cat <<'EOF'\n{{KEY}}\nEOF",
      'cat <<EOF\n{{KEY}}\nEOF',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion
      'printf "%s\\n" "${missing:-{{KEY}}}"',
    ]) {
      await check(`literal value ${JSON.stringify(value)} in ${code}`, async () => {
        assert.equal(execute(await compile(code, value)), `${value}\n`)
        assert(!existsSync(sentinel), 'Literal data must not execute')
      })
    }
  }

  for (const code of [
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion
    'printf "%s\\n" "${missing:-\'{{KEY}}\'}"',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion
    "cat <<EOF\n${missing:-'{{KEY}}'}\nEOF",
  ]) {
    await check(`preserves quoted parameter defaults: ${code}`, async () => {
      assert.equal(execute(await compile(code, payload)), `'${payload}'\n`)
      assert(!existsSync(sentinel))
    })
  }

  const safePrograms = [
    '[[ "{{KEY}}" < \\\n  -eq ]] || printf "%s\\n" ok',
    'time -p printf "%s\\n" "{{KEY}}" >/dev/null; printf "%s\\n" ok',
    'if (( BASH_VERSINFO[0] >= 4 )); then coproc printf "%s\\n" "{{KEY}}" [[ -eq 0 ]]; wait; fi; printf "%s\\n" ok',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion
    'printf %s ${missing:- } [[ "{{KEY}}" -eq 0 ]] >/dev/null; printf "%s\\n" ok',
    'printf %s &>/dev/null [[ "{{KEY}}" -eq 0 ]]; printf "%s\\n" ok',
    '[[ "{{KEY}}" == -eq ]] || printf "%s\\n" ok',
    '[[ "{{KEY}}" < -eq ]] || printf "%s\\n" ok',
    '[[ "{{KEY}}" == values* && 1 -eq 1 ]] && printf "%s\\n" ok',
    '[[ 1 -eq 1 && "{{KEY}}" == values* ]] && printf "%s\\n" ok',
    '[[ ( "{{KEY}}" == values* ) && 1 -eq 1 ]] && printf "%s\\n" ok',
    '[ "{{KEY}}" -eq 0 ] 2>/dev/null || printf "%s\\n" ok',
    'f() { declare -i n; }; n="{{KEY}}"; [[ "$n" == values* ]] && printf "%s\\n" ok',
    'if [[ 1 -eq 1 ]]; then printf "%s\\n" "{{KEY}}" >/dev/null; fi; printf "%s\\n" ok',
    'printf "%s" [[ "{{KEY}}" -eq 0 ]] >/dev/null; printf "%s\\n" ok',
  ]
  for (const code of safePrograms) {
    await check(`preserves safe command: ${code}`, async () => {
      assert.equal(execute(await compile(code, payload)), 'ok\n')
      assert(!existsSync(sentinel))
    })
  }
  await check('preserves a placeholder command name', async () => {
    const compiled = await compileCodePlaceholders({
      code: '{{COMMAND}} [[ "{{KEY}}" -eq 0 ]]',
      language: CodeLanguage.Shell,
      params: { COMMAND: 'printf', KEY: payload },
    })
    assert.equal(execute(compiled), '[[')
    assert(!existsSync(sentinel))
  })
} finally {
  rmSync(directory, { recursive: true, force: true })
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, JSON.stringify({ bash, checks }, null, 2))
}
const failed = checks.filter((result) => result.status === 'failed')
logger.info('Shell placeholder execution complete', {
  passed: checks.length - failed.length,
  failed: failed.length,
  reportPath,
})
if (failed.length) process.exitCode = 1
