/**
 * Generates the SDK types for the fixture catalog into `<outDir>`, reports their size, and
 * type-checks the example workflows and negative fixtures against them.
 *
 *   bun scripts/typecheck-fixtures.ts <outDir>
 */

import path from 'node:path'
import { typecheck, writeTypecheckProject } from '../test/typecheck-project'

const outDir = process.argv[2]
if (!outDir) {
  process.stderr.write('usage: bun scripts/typecheck-fixtures.ts <outDir>\n')
  process.exit(2)
}

const { tsconfig, files } = writeTypecheckProject(path.resolve(outDir))
const bytes = (file: { text: string }) => Buffer.byteLength(file.text)
const total = files.reduce((sum, file) => sum + bytes(file), 0)
const blockTypes = new Set(
  files
    .filter((file) => file.path.startsWith('blocks/'))
    .map((file) => file.path.slice('blocks/'.length, -'.d.ts'.length))
)
const perBlock = files.filter((file) => file.path.startsWith('blocks/')).map(bytes)
const largest = Math.max(...perBlock)
process.stdout.write(
  `${files.length} files, ${total} bytes; ${blockTypes.size} blocks, ${Math.round(total / blockTypes.size)} bytes per block on average, largest ${largest}\n`
)
const diagnostics = typecheck(tsconfig)
process.stdout.write(diagnostics || 'type-check clean\n')
process.exit(diagnostics ? 1 : 0)
