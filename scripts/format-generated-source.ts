import { spawnSync } from 'node:child_process'
import { extname, join } from 'node:path'

export function formatGeneratedSource(source: string, stdinFilePath: string, cwd: string): string {
  // biome.json excludes the generated output dirs, and biome refuses to format a
  // stdin whose declared path is excluded — so declare a neutral path instead;
  // formatting rules do not vary by location, only ignores do. The caller's
  // extension survives, because it is what biome parses the stdin as — a .json
  // document declared as .ts aborts with a parse error, not a format.
  const neutralPath = join(
    cwd,
    'scripts',
    `.generated-format-buffer${extname(stdinFilePath) || '.ts'}`
  )
  const result = spawnSync('bunx', ['biome', 'format', '--stdin-file-path', neutralPath], {
    cwd,
    encoding: 'utf8',
    input: source,
  })

  if (result.status !== 0) {
    throw new Error(
      `Failed to format generated source for ${neutralPath}:\n${
        result.stderr || result.stdout || 'unknown error'
      }`
    )
  }

  return result.stdout
}
