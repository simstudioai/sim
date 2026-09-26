import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  GENERATED_FILE,
  generateContracts,
  generatedBytes,
} from '#design-conformance/generated-contracts'
import { GitSource } from '#design-conformance/worktree-source'

export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const { values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        check: { type: 'boolean' },
        repo: { type: 'string', default: process.cwd() },
        ref: { type: 'string' },
      },
    })
    const start = performance.now()
    const source = new GitSource(values.repo, values.ref ?? 'HEAD', !values.ref)
    const generated = await generateContracts(source.central())
    source.assertUnchanged()
    const output = path.join(values.repo, GENERATED_FILE)
    const bytes = generatedBytes(generated)
    if (values.check) {
      let actual: string | undefined
      try {
        const entry = source.entries.find((e) => e.path === GENERATED_FILE)
        actual = values.ref
          ? entry
            ? source.read(entry)
            : undefined
          : readFileSync(output, 'utf8')
      } catch {}
      if (actual !== bytes) {
        process.stderr.write(
          'Design infrastructure is missing, malformed or stale. Run bun run design:generate and commit contracts.generated.json.\n'
        )
        return 1
      }
    } else {
      mkdirSync(path.dirname(output), { recursive: true })
      writeFileSync(output, bytes)
    }
    process.stdout.write(
      `${values.check ? 'Verified' : 'Generated'} ${Object.keys(generated.exports).length} exports, ${Object.keys(generated.recipes).length} recipes, ${Object.keys(generated.tokens).length} tokens, ${generated.diagnostics.length} diagnostics; ${Buffer.byteLength(bytes)} bytes; ${Math.round(performance.now() - start)}ms; ${process.resourceUsage().maxRSS} KiB max RSS\n`
    )
    return 0
  } catch (error) {
    process.stderr.write(`${String(error)}\n`)
    return 2
  }
}
if (import.meta.main) process.exitCode = await main()
