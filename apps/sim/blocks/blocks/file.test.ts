import { describe, expect, it } from 'vitest'
import { FileV4Block, FileV5Block } from '@/blocks/blocks/file'

describe('FileV4Block', () => {
  const buildParams = FileV4Block.tools.config.params

  it('accepts http and https URLs for fetch', () => {
    expect(
      buildParams({
        operation: 'file_fetch',
        fileUrl: 'https://example.com/image.jpg',
        _context: {
          workspaceId: 'workspace-1',
          workflowId: 'workflow-1',
          executionId: 'execution-1',
        },
      })
    ).toMatchObject({
      fileUrl: 'https://example.com/image.jpg',
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('rejects inline content for fetch', () => {
    expect(() =>
      buildParams({
        operation: 'file_fetch',
        fileUrl: '\u0001\u0002raw jpeg bytes',
      })
    ).toThrow('File URL must be a valid http or https URL')
  })

  it('rejects data URLs for fetch', () => {
    expect(() =>
      buildParams({
        operation: 'file_fetch',
        fileUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD',
      })
    ).toThrow('File URL must use http or https')
  })

  it('rejects valid URLs with unsupported protocols for fetch', () => {
    expect(() =>
      buildParams({
        operation: 'file_fetch',
        fileUrl: 'ftp://example.com/file.pdf',
      })
    ).toThrow('File URL must use http or https')
  })
})

describe('FileV5Block', () => {
  const buildParams = FileV5Block.tools.config.params

  it('maps each operation directly to its tool', () => {
    expect(FileV5Block.tools.config.tool({ operation: 'file_read' })).toBe('file_read')
    expect(FileV5Block.tools.config.tool({ operation: 'file_get_content' })).toBe(
      'file_get_content'
    )
    expect(FileV5Block.tools.config.tool({ operation: 'file_fetch' })).toBe('file_fetch')
    expect(FileV5Block.tools.config.tool({ operation: 'file_write' })).toBe('file_write')
    expect(FileV5Block.tools.config.tool({ operation: 'file_append' })).toBe('file_append')
    expect(FileV5Block.tools.config.tool({ operation: 'file_search' })).toBe('file_search')
  })

  it('keeps the builder-configured search limit as a fixed hard cap', () => {
    expect(
      buildParams({
        operation: 'file_search',
        query: '',
        maxResults: '25',
      })
    ).toEqual({ query: '', mode: 'regex', maxResults: 25 })

    const query = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'query')
    const mode = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'mode')
    const maxResults = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'maxResults')
    expect(query?.paramVisibility).toBe('user-or-llm')
    expect(mode?.paramVisibility).toBe('user-only')
    expect(maxResults?.paramVisibility).toBe('user-only')
    expect(query?.canonicalParamId).toBeUndefined()
    expect(maxResults?.canonicalParamId).toBeUndefined()
    expect(maxResults?.value?.()).toBe('50')
    expect(mode?.value?.()).toBe('regex')
  })

  it.each([
    [undefined, 'regex'],
    ['exact', 'exact'],
    ['regex', 'regex'],
    ['glob', 'regex'],
  ])('resolves the builder-configured match mode %s to %s', (mode, expected) => {
    expect(buildParams({ operation: 'file_search', query: 'needle', mode })).toMatchObject({
      mode: expected,
    })
  })

  it('uses the default search cap when the builder field is cleared', () => {
    expect(
      buildParams({
        operation: 'file_search',
        query: 'needle',
        maxResults: '',
      })
    ).toEqual({ query: 'needle', mode: 'regex', maxResults: 50 })
  })

  it.each(['10.5', '10results', '0', '201'])(
    'rejects invalid builder-configured search cap %s',
    (maxResults) => {
      expect(() =>
        buildParams({
          operation: 'file_search',
          query: 'needle',
          maxResults,
        })
      ).toThrow('Maximum Results must be an integer between 1 and 200')
    }
  )

  it('read returns only the files output (no redundant file)', () => {
    expect(FileV5Block.outputs.files).toBeDefined()
    expect(FileV5Block.outputs.contents).toBeDefined()
    expect(FileV5Block.outputs.results).toBeDefined()
    expect(FileV5Block.outputs.file).toBeUndefined()
  })

  it('resolves canonical IDs for get content', () => {
    expect(
      buildParams({
        operation: 'file_get_content',
        getContentInput: '["file-1","file-2"]',
        _context: { workspaceId: 'workspace-1' },
      })
    ).toEqual({
      fileId: ['file-1', 'file-2'],
      workspaceId: 'workspace-1',
    })
  })

  it('resolves selected file objects for get content', () => {
    expect(
      buildParams({
        operation: 'file_get_content',
        getContentInput: [
          {
            key: 'workspace/workspace-1/notes.md',
            name: 'notes.md',
            path: '/api/files/serve/workspace%2Fworkspace-1%2Fnotes.md?context=workspace',
            size: 10,
            type: 'text/markdown',
          },
        ],
        _context: { workspaceId: 'workspace-1' },
      })
    ).toEqual({
      fileInput: [
        {
          key: 'workspace/workspace-1/notes.md',
          name: 'notes.md',
          path: '/api/files/serve/workspace%2Fworkspace-1%2Fnotes.md?context=workspace',
          size: 10,
          type: 'text/markdown',
        },
      ],
      workspaceId: 'workspace-1',
    })
  })

  it('throws when neither a file nor a folder is provided for get content', () => {
    expect(() => buildParams({ operation: 'file_get_content' })).toThrow(
      'File or folder is required for get content'
    )
  })

  it('maps manage sharing to public access for a canonical file ID', () => {
    expect(
      buildParams({
        operation: 'file_manage_sharing',
        shareInput: 'file-1',
        shareVisibility: 'public',
        _context: { workspaceId: 'workspace-1' },
      })
    ).toEqual({
      fileId: 'file-1',
      isActive: true,
      authType: 'public',
      password: undefined,
      allowedEmails: undefined,
      workspaceId: 'workspace-1',
    })
  })

  it('maps private visibility to a disabled share with no authType', () => {
    expect(
      buildParams({
        operation: 'file_manage_sharing',
        shareInput: 'file-1',
        shareVisibility: 'private',
        _context: { workspaceId: 'workspace-1' },
      })
    ).toMatchObject({
      fileId: 'file-1',
      isActive: false,
      authType: undefined,
    })
  })

  it('passes the password through for password visibility', () => {
    expect(
      buildParams({
        operation: 'file_manage_sharing',
        shareInput: 'file-1',
        shareVisibility: 'password',
        sharePassword: 'hunter2',
        _context: { workspaceId: 'workspace-1' },
      })
    ).toMatchObject({
      fileId: 'file-1',
      isActive: true,
      authType: 'password',
      password: 'hunter2',
    })
  })

  it('splits allowed emails for email visibility', () => {
    expect(
      buildParams({
        operation: 'file_manage_sharing',
        shareInput: 'file-1',
        shareVisibility: 'email',
        shareAllowedEmails: 'a@example.com, b@example.com\n@acme.com',
        _context: { workspaceId: 'workspace-1' },
      })
    ).toMatchObject({
      fileId: 'file-1',
      isActive: true,
      authType: 'email',
      allowedEmails: ['a@example.com', 'b@example.com', '@acme.com'],
    })
  })

  it('resolves the file ID from a selected workspace file object for manage sharing', () => {
    expect(
      buildParams({
        operation: 'file_manage_sharing',
        shareInput: [{ id: 'file-9', name: 'report.pdf' }],
        shareVisibility: 'public',
        _context: { workspaceId: 'workspace-1' },
      })
    ).toMatchObject({
      fileId: 'file-9',
      isActive: true,
      authType: 'public',
    })
  })

  it('passes a picker file object without an id through as fileInput for manage sharing', () => {
    const picked = {
      name: 'report.pdf',
      key: 'workspace/workspace-1/123-abc-report.pdf',
      path: '/api/files/serve/workspace%2Fworkspace-1%2F123-abc-report.pdf?context=workspace',
      size: 10,
      type: 'application/pdf',
    }
    expect(
      buildParams({
        operation: 'file_manage_sharing',
        shareInput: [picked],
        shareVisibility: 'public',
        _context: { workspaceId: 'workspace-1' },
      })
    ).toMatchObject({
      fileInput: picked,
      isActive: true,
      authType: 'public',
    })
  })

  it('throws when no file is provided for manage sharing', () => {
    expect(() => buildParams({ operation: 'file_manage_sharing' })).toThrow(
      'File is required to manage sharing'
    )
  })

  it('rejects multiple file IDs for manage sharing', () => {
    expect(() =>
      buildParams({
        operation: 'file_manage_sharing',
        shareInput: '["file-1","file-2"]',
        shareVisibility: 'public',
        _context: { workspaceId: 'workspace-1' },
      })
    ).toThrow('Manage Sharing accepts a single file at a time')
  })
})
