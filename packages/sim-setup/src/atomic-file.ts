import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { generateShortId } from '@sim/utils/id'

interface AtomicWriteOptions {
  mode: number
}

/** Writes a complete replacement beside its target, then publishes it with one rename. */
export function writeTextFileAtomic(
  filePath: string,
  contents: string,
  options: AtomicWriteOptions
): void {
  const directory = path.dirname(filePath)
  mkdirSync(directory, { recursive: true })
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${generateShortId(10)}.tmp`
  )

  try {
    writeFileSync(temporaryPath, contents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: options.mode,
    })
    renameSync(temporaryPath, filePath)
  } finally {
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
  }
}
