/**
 * The files of a folder that `scripts/generate-embedded-text.ts` embeds for bundled consumers such
 * as the CLI, which write them into users' directories.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** Which files of a folder are embedded, by `/`-separated path relative to it. */
export interface EmbeddedFolder {
  recursive: boolean
  include: (file: string) => boolean
}

/**
 * A folder's embedded files, path → text, in path order. A dotfile or a file under a dot folder
 * (`.DS_Store`, an editor's `.name.swp`) is never embedded: it is local litter, not an example.
 */
export function embeddedFolderTexts(dir: string, files: EmbeddedFolder): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir, { recursive: files.recursive, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
      .map((file) => file.split(path.sep).join('/'))
      .filter((file) => !file.split('/').some((segment) => segment.startsWith('.')))
      .filter(files.include)
      .sort()
      .map((file) => [file, readFileSync(path.join(dir, file), 'utf8')])
  )
}
