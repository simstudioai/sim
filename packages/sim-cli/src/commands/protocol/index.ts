import { Command } from 'commander'
import { attachFileDownload } from './files-download.js'
import { attachFileUpload } from './files-upload.js'
import { attachKnowledgeDocumentUpload } from './knowledge-document-upload.js'
import { attachResourceList } from './resource-ls.js'
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
  attachResourceList(files, {
    kind: 'file',
    resources: 'listFiles',
    folders: 'listFileFolders',
  })

  const knowledge = group(program, 'knowledge')
  attachKnowledgeDocumentUpload(group(knowledge, 'documents'))
  attachResourceList(knowledge, {
    kind: 'knowledge',
    resources: 'listKnowledgeBases',
    folders: 'listKnowledgeFolders',
  })

  const tables = group(program, 'tables')
  attachTableImport(tables)
  attachResourceList(tables, {
    kind: 'table',
    resources: 'listTables',
    folders: 'listTableFolders',
  })

  attachResourceList(group(program, 'workflows'), {
    kind: 'workflow',
    resources: 'listWorkflows',
    folders: 'listWorkflowFolders',
  })
}
