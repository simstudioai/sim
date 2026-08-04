import { Command } from 'commander'
import { attachFileDownload } from './files-download.js'
import { attachFileUpload } from './files-upload.js'
import { attachTableImport } from './tables-import.js'

function group(program: Command, name: string): Command {
  const existing = program.commands.find((command) => command.name() === name)
  if (existing) return existing
  const created = new Command(name)
  program.addCommand(created)
  return created
}

/** Attaches commands whose multi-request or binary protocols cannot be generated. */
export function attachProtocolCommands(program: Command): void {
  const files = group(program, 'files')
  attachFileUpload(files)
  attachFileDownload(files)
  attachTableImport(group(program, 'tables'))
}
