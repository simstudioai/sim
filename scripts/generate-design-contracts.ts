import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import {
  GENERATED_FILE,
  generateContracts,
  generatedBytes,
} from '#design-conformance/generated-contracts'
import { GitSource } from '#design-conformance/worktree-source'

/** Validate each parent before creating descendants; linked parents can redirect missing outputs. */
function outputParents(repo: string, create = false): string {
  let parent = repo
  for (const part of path.dirname(GENERATED_FILE).split('/')) {
    parent = path.join(parent, part)
    let stat = lstatSync(parent, { throwIfNoEntry: false })
    if (!stat && create) {
      mkdirSync(parent)
      stat = lstatSync(parent)
    }
    if (stat && !stat.isDirectory())
      throw new Error(`Generated output has an unsafe parent directory: ${parent}`)
  }
  return path.join(repo, GENERATED_FILE)
}

/** Preflight before working-tree inventory so unsafe outputs are never read as source inputs. */
function checkedOutput(repo: string): void {
  const output = outputParents(repo)
  const stat = lstatSync(output, { throwIfNoEntry: false })
  if (stat && !stat.isFile()) throw new Error('Generated output is not a regular file')
}

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
    const repo = realpathSync(values.repo)
    if (!values.check || !values.ref) checkedOutput(repo)
    const source = new GitSource(repo, values.ref ?? 'HEAD', !values.ref)
    const generated = await generateContracts(source.central())
    source.assertUnchanged()
    const output = path.join(source.repo, GENERATED_FILE)
    const bytes = generatedBytes(generated)
    if (values.check) {
      let actual: string | undefined
      try {
        const entry = source.entries.find((e) => e.path === GENERATED_FILE)
        if (values.ref) actual = entry ? source.read(entry) : undefined
        else {
          const descriptor = openSync(
            output,
            constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
          )
          try {
            if (!fstatSync(descriptor).isFile())
              throw new Error('Generated output is not a regular file')
            outputParents(source.repo)
            actual = readFileSync(descriptor, 'utf8')
          } finally {
            closeSync(descriptor)
          }
        }
      } catch {
        actual = undefined
      }
      if (actual !== bytes) {
        process.stderr.write(
          'Design infrastructure is missing, malformed or stale. Run bun run design:generate and commit contracts.generated.json.\n'
        )
        return 1
      }
    } else {
      outputParents(source.repo, true)
      const descriptor = openSync(
        output,
        constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        0o644
      )
      try {
        if (!fstatSync(descriptor).isFile())
          throw new Error('Generated output is not a regular file')
        outputParents(source.repo)
        ftruncateSync(descriptor, 0)
        writeFileSync(descriptor, bytes)
      } finally {
        closeSync(descriptor)
      }
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
