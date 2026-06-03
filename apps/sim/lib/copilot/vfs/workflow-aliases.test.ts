import { describe, expect, it } from 'vitest'
import {
  buildWorkflowAliasWorkflowEntries,
  isWorkflowAliasBackingPath,
  resolveWorkflowAliasPath,
  resolveWorkspacePlanAliasPath,
  workflowChangelogBackingPath,
  workspacePlanBackingPath,
} from './workflow-aliases'

describe('workflow aliases', () => {
  const folders = [
    { folderId: 'root-a', folderName: 'Folder A', parentId: null },
    { folderId: 'nested', folderName: 'Nested', parentId: 'root-a' },
    { folderId: 'root-b', folderName: 'Folder B', parentId: null },
  ]

  it('resolves root workspace plan aliases to workspace backing files', () => {
    const alias = resolveWorkspacePlanAliasPath('.plans/root.md')

    expect(alias).toMatchObject({
      kind: 'plan_file',
      scope: 'workspace',
      aliasPath: '.plans/root.md',
      planRelativePath: 'root.md',
      backingPath: workspacePlanBackingPath('root.md'),
    })
  })

  it('preserves nested root workspace plan paths in backing storage', () => {
    const alias = resolveWorkspacePlanAliasPath('.plans/nested/phase-1.md')

    expect(alias).toMatchObject({
      kind: 'plan_file',
      scope: 'workspace',
      planRelativePath: 'nested/phase-1.md',
      backingPath: 'files/.plans/workspace/nested/phase-1.md',
    })
  })

  it('rejects root plan directory paths as file aliases', () => {
    expect(resolveWorkspacePlanAliasPath('.plans')).toMatchObject({
      kind: 'plans_dir',
      scope: 'workspace',
    })
    expect(resolveWorkspacePlanAliasPath('.plans/.folder')).toMatchObject({
      kind: 'plans_dir',
      scope: 'workspace',
    })
    expect(resolveWorkspacePlanAliasPath('.plans/links.json')).toBeNull()
  })

  it('resolves root workflow changelog aliases to workflow-id keyed backing files', () => {
    const workflows = buildWorkflowAliasWorkflowEntries(
      [{ id: 'wf_123', name: 'Root Flow', folderId: null }],
      []
    )

    const alias = resolveWorkflowAliasPath('workflows/Root%20Flow/changelog.md', workflows)

    expect(alias).toMatchObject({
      kind: 'changelog',
      workflowId: 'wf_123',
      aliasPath: 'workflows/Root%20Flow/changelog.md',
      backingPath: workflowChangelogBackingPath('wf_123'),
    })
  })

  it('resolves nested plan aliases using the workflow folder path', () => {
    const workflows = buildWorkflowAliasWorkflowEntries(
      [{ id: 'wf_nested', name: 'Planner', folderId: 'nested' }],
      folders
    )

    const alias = resolveWorkflowAliasPath(
      'workflows/Folder%20A/Nested/Planner/.plans/launch.md',
      workflows
    )

    expect(alias).toMatchObject({
      kind: 'plan_file',
      workflowId: 'wf_nested',
      planRelativePath: 'launch.md',
      backingPath: 'files/.plans/wf_nested/launch.md',
    })
  })

  it('keeps same-name workflows in different folders distinct', () => {
    const workflows = buildWorkflowAliasWorkflowEntries(
      [
        { id: 'wf_a', name: 'Duplicate', folderId: 'root-a' },
        { id: 'wf_b', name: 'Duplicate', folderId: 'root-b' },
      ],
      folders
    )

    expect(
      resolveWorkflowAliasPath('workflows/Folder%20A/Duplicate/changelog.md', workflows)
    ).toMatchObject({ workflowId: 'wf_a', backingPath: 'files/.changelogs/wf_a.md' })
    expect(
      resolveWorkflowAliasPath('workflows/Folder%20B/Duplicate/changelog.md', workflows)
    ).toMatchObject({ workflowId: 'wf_b', backingPath: 'files/.changelogs/wf_b.md' })
  })

  it('keeps backing paths stable across workflow rename', () => {
    const before = buildWorkflowAliasWorkflowEntries(
      [{ id: 'wf_stable', name: 'Old Name', folderId: null }],
      []
    )
    const after = buildWorkflowAliasWorkflowEntries(
      [{ id: 'wf_stable', name: 'New Name', folderId: null }],
      []
    )

    expect(resolveWorkflowAliasPath('workflows/Old%20Name/changelog.md', before)?.backingPath).toBe(
      'files/.changelogs/wf_stable.md'
    )
    expect(resolveWorkflowAliasPath('workflows/New%20Name/changelog.md', after)?.backingPath).toBe(
      'files/.changelogs/wf_stable.md'
    )
    expect(resolveWorkflowAliasPath('workflows/Old%20Name/changelog.md', after)).toBeNull()
  })

  it('rejects arbitrary workflow-local files and missing workflows', () => {
    const workflows = buildWorkflowAliasWorkflowEntries(
      [{ id: 'wf_123', name: 'Root Flow', folderId: null }],
      []
    )

    expect(resolveWorkflowAliasPath('workflows/Root%20Flow/random.md', workflows)).toBeNull()
    expect(resolveWorkflowAliasPath('workflows/Missing/changelog.md', workflows)).toBeNull()
  })

  it('recognizes reserved backing paths after VFS segment canonicalization', () => {
    expect(isWorkflowAliasBackingPath('files/.plans/wf_1/launch.md')).toBe(true)
    expect(isWorkflowAliasBackingPath('files/%2Eplans/wf_1/launch.md')).toBe(true)
    expect(isWorkflowAliasBackingPath('files/ordinary/launch.md')).toBe(false)
  })
})
