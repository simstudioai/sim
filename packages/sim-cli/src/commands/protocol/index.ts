import { Command } from 'commander'
import { attachChat } from './chat'
import {
  attachFileGet,
  attachFileVersionDownload,
  attachProjectFileDownload,
  attachProjectFileSnapshotExport,
  attachProjectFileSource,
  attachProjectFileVersionSource,
} from './files-get'
import { attachFileUpload, attachProjectFileUpload } from './files-upload'
import { attachKnowledgeDocumentUpload } from './knowledge-document-upload'
import { attachKnowledgeExport } from './knowledge-export'
import { attachKnowledgeImport } from './knowledge-import'
import { attachLogsFollow } from './logs-follow'
import { attachResourceDirectoryCommands } from './resource-directory'
import { attachTableImport } from './tables-import'
import { attachWorkflowRunFollow } from './workflow-run-follow'
import { attachWorkflowRunGet } from './workflow-run-get'
import { attachWorkflowRunWait } from './workflow-run-wait'
import { attachWorkflowSourceApply, attachWorkflowSourceCreate } from './workflow-source-apply'
import { attachWorkflowSourceGet } from './workflow-source-get'
import { attachWorkspaceOperationWait } from './workspace-operation-wait'
import { attachWorkspaceSourceApply } from './workspace-source-apply'
import { attachWorkspaceSourceGet } from './workspace-source-get'

function group(program: Command, name: string): Command {
  const existing = program.commands.find((command) => command.name() === name)
  if (existing) return existing
  const created = new Command(name)
  program.addCommand(created)
  return created
}

/** Attaches commands whose multi-request or binary protocols cannot be generated. */
export function attachProtocolCommands(program: Command): void {
  const projectFiles = group(group(program, 'projects'), 'files')
  attachProjectFileUpload(projectFiles)
  attachProjectFileSource(projectFiles)
  attachProjectFileDownload(projectFiles)
  attachProjectFileSnapshotExport(projectFiles)
  attachProjectFileVersionSource(group(projectFiles, 'versions'))
  const files = group(program, 'files')
  attachFileUpload(files)
  attachFileGet(files)
  attachFileVersionDownload(group(files, 'versions'))
  attachResourceDirectoryCommands(files, {
    kind: 'file',
    resources: 'listFiles',
    folders: 'listFileFolders',
    createFolder: 'createFileFolder',
  })

  const knowledge = group(program, 'knowledge')
  attachKnowledgeDocumentUpload(group(knowledge, 'documents'))
  attachKnowledgeExport(knowledge)
  attachKnowledgeImport(knowledge)
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

  const workflows = group(program, 'workflows')
  attachResourceDirectoryCommands(workflows, {
    kind: 'workflow',
    resources: 'listWorkflows',
    folders: 'listWorkflowFolders',
    createFolder: 'createWorkflowFolder',
  })
  // All four augment commands the generated pass already built — `run` gains
  // `--follow`, `runs get` gains block names, `runs` gains `wait`, and `source get` gains `--dir` — so they
  // must attach after it, which is the order `buildProgram` calls them in.
  attachWorkflowRunFollow(workflows)
  const runs = group(workflows, 'runs')
  attachWorkflowRunGet(runs)
  attachWorkflowRunWait(runs)
  const source = group(workflows, 'source')
  attachWorkflowSourceGet(source)
  attachWorkflowSourceApply(source)
  attachWorkflowSourceCreate(source)

  const workspaces = group(program, 'workspaces')
  attachWorkspaceOperationWait(group(workspaces, 'operations'))
  const workspaceSource = group(workspaces, 'source')
  attachWorkspaceSourceGet(workspaceSource)
  attachWorkspaceSourceApply(workspaceSource)

  attachLogsFollow(group(program, 'logs'))

  attachChat(program)
}
