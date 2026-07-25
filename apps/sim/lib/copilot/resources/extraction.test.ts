/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractDeletedResourcesFromToolResult, extractResourcesFromToolResult } from './extraction'

describe('extractResourcesFromToolResult', () => {
  it('extracts file resources from create_file results', () => {
    const resources = extractResourcesFromToolResult(
      'create_file',
      {
        fileName: 'notes.md',
      },
      {
        success: true,
        message: 'File "notes.md" created successfully',
        data: {
          id: 'file_123',
          name: 'notes.md',
          contentType: 'text/markdown',
        },
      }
    )

    expect(resources).toEqual([
      {
        type: 'file',
        id: 'file_123',
        title: 'notes.md',
      },
    ])
  })

  it('uses the knowledge base id for knowledge_base tag mutations', () => {
    const resources = extractResourcesFromToolResult(
      'knowledge_base',
      {
        operation: 'update_tag',
        args: {
          knowledgeBaseId: 'kb_123',
          tagDefinitionId: 'tag_456',
        },
      },
      {
        success: true,
        message: 'Tag updated successfully',
        data: {
          id: 'tag_456',
          displayName: 'Priority',
          fieldType: 'text',
        },
      }
    )

    expect(resources).toEqual([
      {
        type: 'knowledgebase',
        id: 'kb_123',
        title: 'Knowledge Base',
      },
    ])
  })

  it('uses knowledgeBaseId from the tool result when update_tag args omit it', () => {
    const resources = extractResourcesFromToolResult(
      'knowledge_base',
      {
        operation: 'update_tag',
        args: {
          tagDefinitionId: 'tag_456',
        },
      },
      {
        success: true,
        message: 'Tag updated successfully',
        data: {
          id: 'tag_456',
          knowledgeBaseId: 'kb_123',
          displayName: 'Priority',
          fieldType: 'text',
        },
      }
    )

    expect(resources).toEqual([
      {
        type: 'knowledgebase',
        id: 'kb_123',
        title: 'Knowledge Base',
      },
    ])
  })

  it('does not create resources for read-only knowledge base tag operations', () => {
    const resources = extractResourcesFromToolResult(
      'knowledge_base',
      {
        operation: 'list_tags',
        args: {
          knowledgeBaseId: 'kb_123',
        },
      },
      {
        success: true,
        data: [],
      }
    )

    expect(resources).toEqual([])
  })

  it.each([
    ['generate_video', 'ad-clip.mp4'],
    ['generate_audio', 'voiceover.mp3'],
    ['ffmpeg', 'final-ad.mp4'],
  ])('auto-opens the generated file from %s results', (toolName, fileName) => {
    const resources = extractResourcesFromToolResult(
      toolName,
      {},
      {
        success: true,
        message: `Saved at "files/${fileName}"`,
        fileId: 'file_media_123',
        fileName,
      }
    )

    expect(resources).toEqual([{ type: 'file', id: 'file_media_123', title: fileName }])
  })

  it('does not create a resource for ffmpeg probe (no file written)', () => {
    const resources = extractResourcesFromToolResult(
      'ffmpeg',
      { operation: 'probe' },
      {
        success: true,
        message: 'Probed media',
        probe: { durationSeconds: 12.5, width: 1080, height: 1920 },
      }
    )

    expect(resources).toEqual([])
  })

  it('auto-opens a scheduledtask resource from manage_scheduled_task create results', () => {
    const resources = extractResourcesFromToolResult(
      'manage_scheduled_task',
      { operation: 'create', args: { title: 'Daily Report' } },
      { jobId: 'sched_123', title: 'Daily Report', message: 'Job created successfully.' }
    )

    expect(resources).toEqual([{ type: 'scheduledtask', id: 'sched_123', title: 'Daily Report' }])
  })

  it('auto-opens a scheduledtask resource on update, falling back to the args title', () => {
    const resources = extractResourcesFromToolResult(
      'manage_scheduled_task',
      { operation: 'update', args: { jobId: 'sched_123', title: 'Renamed Task' } },
      { jobId: 'sched_123', updated: ['title'], message: 'Job updated successfully' }
    )

    expect(resources).toEqual([{ type: 'scheduledtask', id: 'sched_123', title: 'Renamed Task' }])
  })

  it('does not auto-open for read-only manage_scheduled_task operations', () => {
    expect(
      extractResourcesFromToolResult(
        'manage_scheduled_task',
        { operation: 'list' },
        { jobs: [], count: 0 }
      )
    ).toEqual([])
    expect(
      extractResourcesFromToolResult(
        'manage_scheduled_task',
        { operation: 'get', args: { jobId: 'sched_123' } },
        { id: 'sched_123', title: 'Daily Report' }
      )
    ).toEqual([])
  })
})

describe('extractDeletedResourcesFromToolResult', () => {
  it('extracts every successfully deleted workflow from the batch result', () => {
    const resources = extractDeletedResourcesFromToolResult(
      'delete_workflow',
      { workflowIds: ['wf-1', 'wf-2', 'wf-failed'] },
      {
        deleted: [
          { workflowId: 'wf-1', name: 'First workflow' },
          { workflowId: 'wf-2', name: 'Second workflow' },
        ],
        failed: ['wf-failed'],
      }
    )

    expect(resources).toEqual([
      { type: 'workflow', id: 'wf-1', title: 'First workflow' },
      { type: 'workflow', id: 'wf-2', title: 'Second workflow' },
    ])
  })

  it('extracts deleted files from delete_file result data', () => {
    expect(
      extractDeletedResourcesFromToolResult(
        'delete_file',
        { paths: ['files/one.md', 'files/two.md'] },
        {
          success: true,
          data: {
            deleted: [
              { id: 'file-1', name: 'one.md' },
              { id: 'file-2', name: 'two.md' },
            ],
            failed: [],
          },
        }
      )
    ).toEqual([
      { type: 'file', id: 'file-1', title: 'one.md' },
      { type: 'file', id: 'file-2', title: 'two.md' },
    ])
  })

  it('extracts deleted file folders from delete_file_folder result data', () => {
    expect(
      extractDeletedResourcesFromToolResult(
        'delete_file_folder',
        { paths: ['files/Archive'] },
        { success: true, data: { folders: 1, files: 2, deletedFolderIds: ['folder-1'] } }
      )
    ).toEqual([{ type: 'filefolder', id: 'folder-1', title: 'Folder' }])
  })

  it('extracts only successfully deleted tables from user_table result data', () => {
    expect(
      extractDeletedResourcesFromToolResult(
        'user_table',
        { operation: 'delete', args: { tableIds: ['table-1', 'table-failed'] } },
        { success: true, data: { deleted: ['table-1'], failed: ['table-failed'] } }
      )
    ).toEqual([{ type: 'table', id: 'table-1', title: 'Table' }])
  })

  it('extracts deleted knowledge bases from knowledge_base result data', () => {
    expect(
      extractDeletedResourcesFromToolResult(
        'knowledge_base',
        { operation: 'delete', args: { knowledgeBaseIds: ['kb-1'] } },
        {
          success: true,
          data: { deleted: [{ id: 'kb-1', name: 'Docs' }], notFound: [] },
        }
      )
    ).toEqual([{ type: 'knowledgebase', id: 'kb-1', title: 'Docs' }])
  })

  it('extracts deleted workflow folders from manage_folder delete results', () => {
    expect(
      extractDeletedResourcesFromToolResult(
        'manage_folder',
        { operation: 'delete', folderId: 'folder-1' },
        { deleted: ['folder-1'], failed: [] }
      )
    ).toEqual([{ type: 'folder', id: 'folder-1', title: 'Folder' }])
  })

  it('removes scheduledtask resources on manage_scheduled_task delete', () => {
    const resources = extractDeletedResourcesFromToolResult(
      'manage_scheduled_task',
      { operation: 'delete', args: { jobIds: ['sched_1', 'sched_2'] } },
      { deleted: ['sched_1', 'sched_2'], notFound: [] }
    )

    expect(resources).toEqual([
      { type: 'scheduledtask', id: 'sched_1', title: 'Scheduled Task' },
      { type: 'scheduledtask', id: 'sched_2', title: 'Scheduled Task' },
    ])
  })

  it('does not remove anything for non-delete manage_scheduled_task ops', () => {
    expect(
      extractDeletedResourcesFromToolResult(
        'manage_scheduled_task',
        { operation: 'update', args: { jobId: 'sched_1' } },
        { jobId: 'sched_1', updated: ['title'] }
      )
    ).toEqual([])
  })
})
