import { Command } from 'commander'
import { attachFileGet } from './files-get'
import { attachFileUpload } from './files-upload'
import { attachKnowledgeDocumentUpload } from './knowledge-document-upload'
import { attachResourceDirectoryCommands } from './resource-directory'
import { attachTableImport } from './tables-import'

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
  attachFileGet(files)
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
