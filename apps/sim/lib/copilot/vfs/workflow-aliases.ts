import { normalizeVfsSegment } from '@/lib/copilot/vfs/normalize-segment'
import {
  canonicalWorkspaceFilePath,
  decodeVfsPathSegments,
  encodeVfsPathSegments,
} from '@/lib/copilot/vfs/path-utils'
import type { WorkspaceFileRecord } from '@/lib/uploads/contexts/workspace/workspace-file-manager'

export const WORKFLOW_CHANGELOG_ALIAS_NAME = 'changelog.md'
export const WORKFLOW_PLANS_ALIAS_DIR = '.plans'
export const WORKFLOW_ALIAS_LINKS_NAME = 'links.json'
export const WORKFLOW_CHANGELOG_BACKING_FOLDER = '.changelogs'
export const WORKFLOW_PLANS_BACKING_FOLDER = '.plans'
export const WORKSPACE_PLANS_BACKING_FOLDER = 'workspace'

export type WorkflowAliasKind = 'changelog' | 'plan_file' | 'plans_dir'
export type WorkflowAliasScope = 'workspace' | 'workflow'

export interface WorkflowAliasWorkflow {
  id: string
  name: string
  folderPath?: string | null
}

export interface WorkflowAliasWorkflowRow {
  id: string
  name: string
  folderId?: string | null
}

export interface WorkflowAliasFolderRow {
  folderId: string
  folderName: string
  parentId: string | null
}

interface BaseWorkflowAliasTarget {
  kind: WorkflowAliasKind
  scope: WorkflowAliasScope
  aliasPath: string
  backingPath: string
  backingFolderPath: string
  planRelativePath?: string
}

export type WorkflowAliasTarget =
  | (BaseWorkflowAliasTarget & {
      kind: 'changelog'
      scope: 'workflow'
      workflowId: string
      workflowName: string
      workflowPath: string
    })
  | (BaseWorkflowAliasTarget & {
      kind: 'plans_dir'
      scope: 'workflow'
      workflowId: string
      workflowName: string
      workflowPath: string
    })
  | (BaseWorkflowAliasTarget & {
      kind: 'plan_file'
      scope: 'workflow'
      workflowId: string
      workflowName: string
      workflowPath: string
      planRelativePath: string
    })
  | (BaseWorkflowAliasTarget & {
      kind: 'plans_dir'
      scope: 'workspace'
    })
  | (BaseWorkflowAliasTarget & {
      kind: 'plan_file'
      scope: 'workspace'
      planRelativePath: string
    })

export interface WorkflowAliasLink {
  kind: WorkflowAliasKind
  aliasPath: string
  backingPath: string
  backingFileId?: string
}

export function workflowVfsPath(workflow: WorkflowAliasWorkflow): string {
  const safeName = normalizeVfsSegment(workflow.name)
  return workflow.folderPath
    ? `workflows/${workflow.folderPath}/${safeName}`
    : `workflows/${safeName}`
}

export function buildWorkflowAliasWorkflowEntries(
  workflows: WorkflowAliasWorkflowRow[],
  folders: WorkflowAliasFolderRow[]
): WorkflowAliasWorkflow[] {
  const folderMap = new Map<string, { name: string; parentId: string | null }>()
  for (const folder of folders) {
    folderMap.set(folder.folderId, { name: folder.folderName, parentId: folder.parentId })
  }

  const folderPathCache = new Map<string, string>()
  const folderPath = (folderId: string): string => {
    const cached = folderPathCache.get(folderId)
    if (cached) return cached

    const folder = folderMap.get(folderId)
    if (!folder) return ''

    const safeName = normalizeVfsSegment(folder.name)
    const path = folder.parentId ? `${folderPath(folder.parentId)}/${safeName}` : safeName
    folderPathCache.set(folderId, path)
    return path
  }

  return workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    folderPath: workflow.folderId ? folderPath(workflow.folderId) : null,
  }))
}

export function workflowChangelogBackingPath(workflowId: string): string {
  return canonicalWorkspaceFilePath({
    folderPath: WORKFLOW_CHANGELOG_BACKING_FOLDER,
    name: `${workflowId}.md`,
  })
}

export function workflowPlansBackingFolderPath(workflowId: string): string {
  return `files/${normalizeVfsSegment(WORKFLOW_PLANS_BACKING_FOLDER)}/${normalizeVfsSegment(workflowId)}`
}

export function workspacePlansBackingFolderPath(): string {
  return `files/${normalizeVfsSegment(WORKFLOW_PLANS_BACKING_FOLDER)}/${normalizeVfsSegment(WORKSPACE_PLANS_BACKING_FOLDER)}`
}

export function workspacePlanBackingPath(planRelativePath: string): string {
  const segments = decodeVfsPathSegments(planRelativePath)
  if (segments.length === 0) {
    throw new Error('Workspace plan alias must include a plan file path')
  }
  return canonicalWorkspaceFilePath({
    folderPath: [
      WORKFLOW_PLANS_BACKING_FOLDER,
      WORKSPACE_PLANS_BACKING_FOLDER,
      ...segments.slice(0, -1),
    ].join('/'),
    name: segments[segments.length - 1],
  })
}

export function workflowPlanBackingPath(workflowId: string, planRelativePath: string): string {
  const segments = decodeVfsPathSegments(planRelativePath)
  if (segments.length === 0) {
    throw new Error('Workflow plan alias must include a plan file path')
  }
  return canonicalWorkspaceFilePath({
    folderPath: [WORKFLOW_PLANS_BACKING_FOLDER, workflowId, ...segments.slice(0, -1)].join('/'),
    name: segments[segments.length - 1],
  })
}

function workflowAliasTargetForPath(workflow: WorkflowAliasWorkflow, rawPath: string) {
  const workflowPath = workflowVfsPath(workflow)
  const changelogPath = `${workflowPath}/${WORKFLOW_CHANGELOG_ALIAS_NAME}`
  if (rawPath === changelogPath) {
    return {
      kind: 'changelog' as const,
      scope: 'workflow' as const,
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowPath,
      aliasPath: changelogPath,
      backingPath: workflowChangelogBackingPath(workflow.id),
      backingFolderPath: `files/${normalizeVfsSegment(WORKFLOW_CHANGELOG_BACKING_FOLDER)}`,
    }
  }

  const plansDirPath = `${workflowPath}/${WORKFLOW_PLANS_ALIAS_DIR}`
  if (rawPath === plansDirPath || rawPath === `${plansDirPath}/.folder`) {
    return {
      kind: 'plans_dir' as const,
      scope: 'workflow' as const,
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowPath,
      aliasPath: plansDirPath,
      backingPath: workflowPlansBackingFolderPath(workflow.id),
      backingFolderPath: workflowPlansBackingFolderPath(workflow.id),
    }
  }

  const plansPrefix = `${plansDirPath}/`
  if (rawPath.startsWith(plansPrefix)) {
    const planRelativePath = rawPath.slice(plansPrefix.length)
    if (!planRelativePath || planRelativePath === '.folder') return null
    return {
      kind: 'plan_file' as const,
      scope: 'workflow' as const,
      workflowId: workflow.id,
      workflowName: workflow.name,
      workflowPath,
      aliasPath: rawPath,
      backingPath: workflowPlanBackingPath(workflow.id, planRelativePath),
      backingFolderPath: workflowPlansBackingFolderPath(workflow.id),
      planRelativePath,
    }
  }

  return null
}

export function resolveWorkspacePlanAliasPath(path: string): WorkflowAliasTarget | null {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, '')
  if (
    normalizedPath === WORKFLOW_PLANS_ALIAS_DIR ||
    normalizedPath === `${WORKFLOW_PLANS_ALIAS_DIR}/.folder`
  ) {
    return {
      kind: 'plans_dir',
      scope: 'workspace',
      aliasPath: WORKFLOW_PLANS_ALIAS_DIR,
      backingPath: workspacePlansBackingFolderPath(),
      backingFolderPath: workspacePlansBackingFolderPath(),
    }
  }

  const plansPrefix = `${WORKFLOW_PLANS_ALIAS_DIR}/`
  if (!normalizedPath.startsWith(plansPrefix)) return null
  const planRelativePath = normalizedPath.slice(plansPrefix.length)
  if (
    !planRelativePath ||
    planRelativePath === '.folder' ||
    planRelativePath === WORKFLOW_ALIAS_LINKS_NAME
  ) {
    return null
  }
  return {
    kind: 'plan_file',
    scope: 'workspace',
    aliasPath: normalizedPath,
    backingPath: workspacePlanBackingPath(planRelativePath),
    backingFolderPath: workspacePlansBackingFolderPath(),
    planRelativePath,
  }
}

export function resolveWorkflowAliasPath(
  path: string,
  workflows: WorkflowAliasWorkflow[]
): WorkflowAliasTarget | null {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, '')
  if (!normalizedPath.startsWith('workflows/')) return null

  const bySpecificity = [...workflows].sort(
    (a, b) => workflowVfsPath(b).length - workflowVfsPath(a).length
  )
  for (const workflow of bySpecificity) {
    const target = workflowAliasTargetForPath(workflow, normalizedPath)
    if (target) return target
  }
  return null
}

export function isWorkflowAliasPath(path: string): boolean {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, '')
  return (
    normalizedPath.startsWith('workflows/') &&
    (normalizedPath.endsWith(`/${WORKFLOW_CHANGELOG_ALIAS_NAME}`) ||
      normalizedPath.includes(`/${WORKFLOW_PLANS_ALIAS_DIR}/`) ||
      normalizedPath.endsWith(`/${WORKFLOW_PLANS_ALIAS_DIR}`))
  )
}

export function isWorkspacePlanAliasPath(path: string): boolean {
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, '')
  return (
    normalizedPath === WORKFLOW_PLANS_ALIAS_DIR ||
    normalizedPath.startsWith(`${WORKFLOW_PLANS_ALIAS_DIR}/`)
  )
}

export function isPlanAliasPath(path: string): boolean {
  return isWorkspacePlanAliasPath(path) || isWorkflowAliasPath(path)
}

export function isWorkflowAliasBackingPath(path: string): boolean {
  const trimmedPath = path.trim().replace(/^\/+|\/+$/g, '')
  let normalizedPath = trimmedPath
  if (trimmedPath.startsWith('files/')) {
    try {
      normalizedPath = `files/${decodeVfsPathSegments(trimmedPath.slice('files/'.length))
        .map((segment) => normalizeVfsSegment(segment))
        .join('/')}`
    } catch {
      normalizedPath = trimmedPath
    }
  }
  return (
    normalizedPath === `files/${normalizeVfsSegment(WORKFLOW_CHANGELOG_BACKING_FOLDER)}` ||
    normalizedPath === `files/${normalizeVfsSegment(WORKFLOW_PLANS_BACKING_FOLDER)}` ||
    normalizedPath.startsWith(`files/${normalizeVfsSegment(WORKFLOW_CHANGELOG_BACKING_FOLDER)}/`) ||
    normalizedPath.startsWith(`files/${normalizeVfsSegment(WORKFLOW_PLANS_BACKING_FOLDER)}/`)
  )
}

export function isReservedWorkflowAliasBackingDisplayPath(path?: string | null): boolean {
  if (!path) return false
  const normalizedPath = path.trim().replace(/^\/+|\/+$/g, '')
  return (
    normalizedPath === WORKFLOW_CHANGELOG_BACKING_FOLDER ||
    normalizedPath === WORKFLOW_PLANS_BACKING_FOLDER ||
    normalizedPath.startsWith(`${WORKFLOW_CHANGELOG_BACKING_FOLDER}/`) ||
    normalizedPath.startsWith(`${WORKFLOW_PLANS_BACKING_FOLDER}/`)
  )
}

export function workflowAliasSandboxPath(aliasPath: string): string {
  return `/home/user/${aliasPath.trim().replace(/^\/+/, '')}`
}

export function buildWorkflowAliasLinks(args: {
  workflowPath: string
  workflowId: string
  changelog?: WorkspaceFileRecord | null
  planFiles?: WorkspaceFileRecord[]
}): WorkflowAliasLink[] {
  const links: WorkflowAliasLink[] = [
    {
      kind: 'changelog',
      aliasPath: `${args.workflowPath}/${WORKFLOW_CHANGELOG_ALIAS_NAME}`,
      backingPath: workflowChangelogBackingPath(args.workflowId),
      backingFileId: args.changelog?.id,
    },
    {
      kind: 'plans_dir',
      aliasPath: `${args.workflowPath}/${WORKFLOW_PLANS_ALIAS_DIR}`,
      backingPath: workflowPlansBackingFolderPath(args.workflowId),
    },
  ]

  for (const file of args.planFiles ?? []) {
    const relativePath = file.folderPath
      ?.replace(`${WORKFLOW_PLANS_BACKING_FOLDER}/${args.workflowId}`, '')
      .replace(/^\/+/, '')
    const aliasRelativePath = encodeVfsPathSegments(
      [relativePath, file.name].filter(Boolean).join('/').split('/')
    )
    const aliasPath = [args.workflowPath, WORKFLOW_PLANS_ALIAS_DIR, aliasRelativePath].join('/')
    links.push({
      kind: 'plan_file',
      aliasPath,
      backingPath: canonicalWorkspaceFilePath({ folderPath: file.folderPath, name: file.name }),
      backingFileId: file.id,
    })
  }

  return links
}
