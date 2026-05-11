import { spawnSync } from 'node:child_process'

export function formatGeneratedSource(source: string, stdinFilePath: string, cwd: string): string {
  const result = spawnSync('bunx', ['biome', 'format', '--stdin-file-path', stdinFilePath], {
    cwd,
    encoding: 'utf8',
    input: source,
  })

  if (result.status !== 0) {
    throw new Error(
      `Failed to format generated source for ${stdinFilePath}:\n${
        result.stderr || result.stdout || 'unknown error'
      }`
    )
  }

  return result.stdout
}
