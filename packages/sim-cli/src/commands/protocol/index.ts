import { Command } from 'commander'
import { chatCommand } from './chat.js'
import { attachFileDownload } from './files-download.js'
import { attachFileUpload } from './files-upload.js'
import { attachKnowledgeDocumentUpload } from './knowledge-document-upload.js'
import { attachResourceDirectoryCommands } from './resource-directory.js'
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
  program.addCommand(chatCommand())

  const files = group(program, 'files')
  attachFileUpload(files)
  attachFileDownload(files)
  attachResourceDirectoryCommands(files, {
    kind: 'file',
    resources: 'listFiles',
    folders: 'listFileFolders',
    createFolder: 'createFileFolder',
  })

  const knowledge = group(program, 'knowledge')
  attachKnowledgeDocumentUpload(group(knowledge, 'documents'))
  attachResourceDirectoryCommands(knowledge, {
    kind: 'knowledge',
    resources: 'listKnowledgeBases',
    folders: 'listKnowledgeFolders',
    createFolder: 'createKnowledgeFolder',
  })

  const tables = group(program, 'tables')
  attachTableImport(tables)
  attachResourceDirectoryCommands(tables, {
    kind: 'table',
    resources: 'listTables',
    folders: 'listTableFolders',
    createFolder: 'createTableFolder',
  })

  attachResourceDirectoryCommands(group(program, 'workflows'), {
    kind: 'workflow',
    resources: 'listWorkflows',
    folders: 'listWorkflowFolders',
    createFolder: 'createWorkflowFolder',
  })
}
