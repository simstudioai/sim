/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { extractDeletedResourcesFromToolResult, extractResourcesFromToolResult } from './extraction'

describe('extractResourcesFromToolResult', () => {
  it('extracts file resources from create_empty_file results', () => {
    const resources = extractResourcesFromToolResult(
      'create_empty_file',
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

  it('uses the knowledge base id for manage_knowledge_base tag mutations', () => {
    const resources = extractResourcesFromToolResult(
      'manage_knowledge_base',
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
      'manage_knowledge_base',
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
      'manage_knowledge_base',
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
})

describe('extractDeletedResourcesFromToolResult', () => {
  it('extracts every kind rm deleted and skips the ones that failed', () => {
    expect(
      extractDeletedResourcesFromToolResult(
        'rm',
        { paths: ['files/Reports/Old%20Report.pdf'] },
        {
          results: [
            { from: 'files/Reports/Old%20Report.pdf', kind: 'file', id: 'file-1' },
            { from: 'files/Archive', kind: 'file_folder', id: 'folder-1' },
            { from: 'workflows/Lead%20Router', kind: 'workflow', id: 'wf-1' },
            { from: 'workflows/Old%20Projects', kind: 'workflow_folder', id: 'wfolder-1' },
            { from: 'tables/Leads', kind: 'table', id: 'tbl-1' },
            { from: 'knowledgebases/support-docs', kind: 'manage_knowledge_base', id: 'kb-1' },
            { from: 'files/missing.md', kind: 'file', error: 'Not found: files/missing.md' },
          ],
        }
      )
    ).toEqual([
      { type: 'file', id: 'file-1', title: 'Old Report.pdf' },
      { type: 'filefolder', id: 'folder-1', title: 'Archive' },
      { type: 'workflow', id: 'wf-1', title: 'Lead Router' },
      { type: 'folder', id: 'wfolder-1', title: 'Old Projects' },
      { type: 'table', id: 'tbl-1', title: 'Leads' },
      { type: 'knowledgebase', id: 'kb-1', title: 'support-docs' },
    ])
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

  it('extracts deleted knowledge bases from manage_knowledge_base result data', () => {
    expect(
      extractDeletedResourcesFromToolResult(
        'manage_knowledge_base',
        { operation: 'delete', args: { knowledgeBaseIds: ['kb-1'] } },
        {
          success: true,
          data: { deleted: [{ id: 'kb-1', name: 'Docs' }], notFound: [] },
        }
      )
    ).toEqual([{ type: 'knowledgebase', id: 'kb-1', title: 'Docs' }])
  })
})

describe('extractResourcesFromToolResult for table_views', () => {
  const written = {
    success: true,
    message: 'Created view "Overdue" (view_1)',
    data: {
      tableId: 'tbl_1',
      tableName: 'Invoices',
      viewId: 'view_1',
      view: { id: 'view_1', name: 'Overdue', isDefault: false, filter: null, sort: null },
    },
  }

  it.each(['create_view', 'update_view', 'set_default_view'])(
    '%s opens the table pinned to the view it wrote',
    (operation) => {
      expect(
        extractResourcesFromToolResult(
          'table_views',
          { operation, args: { tableId: 'tbl_1' } },
          written
        )
      ).toEqual([{ type: 'table', id: 'tbl_1', title: 'Invoices', viewId: 'view_1' }])
    }
  )

  it('a delete opens the table without a pin', () => {
    expect(
      extractResourcesFromToolResult(
        'table_views',
        { operation: 'delete_view', args: { tableId: 'tbl_1', viewId: 'view_1' } },
        {
          success: true,
          message: 'Deleted view "Overdue"',
          data: { tableId: 'tbl_1', tableName: 'Invoices' },
        }
      )
    ).toEqual([{ type: 'table', id: 'tbl_1', title: 'Invoices' }])
  })

  it.each(['list_views', 'get_view'])('%s opens nothing', (operation) => {
    expect(
      extractResourcesFromToolResult(
        'table_views',
        { operation, args: { tableId: 'tbl_1' } },
        written
      )
    ).toEqual([])
  })

  it('falls back to the argument table id when the result names none', () => {
    expect(
      extractResourcesFromToolResult(
        'table_views',
        { operation: 'update_view', args: { tableId: 'tbl_1', viewId: 'view_1' } },
        { success: true, message: 'Updated view' }
      )
    ).toEqual([{ type: 'table', id: 'tbl_1', title: 'Table' }])
  })
})
