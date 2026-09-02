/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  fileManageCreateFolderBodySchema,
  fileManageDeleteFolderBodySchema,
  fileManageListBodySchema,
  fileManageMoveBodySchema,
  fileManageRestoreFolderBodySchema,
  fileManageUpdateFolderBodySchema,
} from '@/lib/api/contracts/tools/file'
import { FileV4Block, FileV5Block } from '@/blocks/blocks/file'

/*
 * The block's params transformer feeds the tool route directly, so its output
 * has to satisfy the same contract the route validates against. Testing the two
 * separately is what let a blank text field ship as '' — a value the contract
 * rejects as a malformed path rather than reading as "not supplied".
 *
 * Every folder field is a canonical pair, so these pass the CANONICAL id
 * (`folderRef`, not `folderPath`): the serializer deletes the subblock ids and
 * republishes whichever member is active under the canonical one.
 */
function paramsFor(operation: string, extra: Record<string, unknown> = {}) {
  const transform = FileV5Block.tools.config?.params
  if (!transform) throw new Error('file_v5 has no params transformer')
  return transform({ operation, _context: { workspaceId: 'ws-1' }, ...extra })
}

describe('file_v5 folder operations produce contract-valid tool input', () => {
  it('omits a blank optional path instead of sending an empty string', () => {
    const params = paramsFor('file_list', {
      folderRef: '',
      folderSearch: '',
      folderRecursive: false,
    })

    expect(params.path).toBeUndefined()
    expect(params.search).toBeUndefined()
    expect(fileManageListBodySchema.safeParse({ operation: 'list', ...params }).success).toBe(true)
  })

  it('accepts a switch set as the string a subblock can emit', () => {
    expect(paramsFor('file_list', { folderRecursive: 'true' }).recursive).toBe(true)
    expect(
      paramsFor('file_delete_folder', { folderRef: '/A', deleteFolderRecursive: 'true' }).recursive
    ).toBe(true)
  })

  it('coerces a typed depth to a number', () => {
    const params = paramsFor('file_list', { folderDepth: '3' })

    expect(params.depth).toBe(3)
    expect(fileManageListBodySchema.safeParse({ operation: 'list', ...params }).success).toBe(true)
  })

  it.each([
    [
      'file_delete_folder',
      'delete_folder',
      fileManageDeleteFolderBodySchema,
      { folderRef: '/Reports' },
    ],
    [
      'file_restore_folder',
      'restore_folder',
      fileManageRestoreFolderBodySchema,
      { restoreFolderId: 'fld-1' },
    ],
  ])('%s satisfies its contract', (operation, wireOperation, schema, extra) => {
    const params = paramsFor(operation, extra)

    expect(schema.safeParse({ operation: wireOperation, ...params }).success).toBe(true)
  })

  /*
   * A folder is created by naming it inside a parent. The name is typed, so it
   * arrives decoded and has to be percent-encoded before it can be part of a
   * canonical path.
   */
  describe('create composes a path from a parent and a name', () => {
    it('encodes the typed name', () => {
      const params = paramsFor('file_create_folder', {
        createParentRef: '/Reports',
        folderName: 'Q3 Results',
      })

      expect(params.path).toBe('/Reports/Q3%20Results')
      expect(
        fileManageCreateFolderBodySchema.safeParse({ operation: 'create_folder', ...params })
          .success
      ).toBe(true)
    })

    it('creates at the workspace root when no parent is picked', () => {
      expect(paramsFor('file_create_folder', { folderName: 'Reports' }).path).toBe('/Reports')
    })

    it('encodes a name containing a slash rather than splitting on it', () => {
      expect(paramsFor('file_create_folder', { folderName: 'Q3/Q4' }).path).toBe('/Q3%2FQ4')
    })

    it('sends no path at all when the name is blank', () => {
      expect(paramsFor('file_create_folder', { createParentRef: '/Reports' }).path).toBeUndefined()
    })
  })

  /*
   * Move takes the path the folder will HAVE, which does not exist yet and so
   * cannot come from a picker. The folder keeps its own name; renaming is a
   * separate concern and is not offered on this operation.
   */
  describe('move composes a destination that does not exist yet', () => {
    it('moves into a folder, carrying the source name', () => {
      const params = paramsFor('file_update_folder', {
        folderRef: '/Reports',
        destinationParentRef: '/Archive',
      })

      expect(params.destinationPath).toBe('/Archive/Reports')
      expect(
        fileManageUpdateFolderBodySchema.safeParse({ operation: 'update_folder', ...params })
          .success
      ).toBe(true)
    })

    it('moves to the workspace root when no parent is picked', () => {
      expect(
        paramsFor('file_update_folder', { folderRef: '/Archive/Reports' }).destinationPath
      ).toBe('/Reports')
    })

    it('preserves a source name that already contains an encoded slash', () => {
      expect(
        paramsFor('file_update_folder', {
          folderRef: '/Q3%2FQ4',
          destinationParentRef: '/Archive',
        }).destinationPath
      ).toBe('/Archive/Q3%2FQ4')
    })
  })

  describe('move file', () => {
    it('sends the canonical destination the picker produced', () => {
      const params = paramsFor('file_move', {
        moveFileId: 'wf_123',
        moveTargetRef: '/Reports/Q3%20Results',
      })

      expect(params.fileId).toBe('wf_123')
      expect(params.folderPath).toBe('/Reports/Q3%20Results')
      expect(fileManageMoveBodySchema.safeParse({ operation: 'move', ...params }).success).toBe(
        true
      )
    })

    it('omits the destination when no folder is picked', () => {
      const params = paramsFor('file_move', { moveFileId: 'wf_123' })

      expect(params.folderPath).toBeUndefined()
      expect(fileManageMoveBodySchema.safeParse({ operation: 'move', ...params }).success).toBe(
        true
      )
    })
  })

  describe('write takes a folder, append does not', () => {
    it('sends the picked folder alongside the file name on write', () => {
      const params = paramsFor('file_write', {
        fileName: 'data.csv',
        content: 'a,b',
        writeFolderRef: '/Reports',
      })

      expect(params.fileName).toBe('data.csv')
      expect(params.folderPath).toBe('/Reports')
    })

    it('omits the folder on write when none is picked', () => {
      expect(
        paramsFor('file_write', { fileName: 'data.csv', content: 'a,b' }).folderPath
      ).toBeUndefined()
    })

    /*
     * Append gets the folder field too, but it only ever narrows the picker: a
     * file is the target, and a folder is not a thing you can append to. So the
     * folder shapes the options and stops — sending it would imply a second
     * target. The earlier version of this field was removed precisely because
     * it looked like it scoped the picker without doing so; now it does.
     */
    /*
     * A picked file is a canonical id and already exact, so the folder beside
     * it would be a second constraint on one target. A typed name is not
     * exact — that case is the next test.
     */
    it('sends no folder when append resolved the file by id', () => {
      const params = paramsFor('file_append', {
        appendFileInput: { id: 'wf_abc', name: 'notes.md' },
        appendContent: 'more',
        folderScopeRef: '/Reports',
      })

      expect(params.folderPath).toBeUndefined()
      expect(params.folderPaths).toBeUndefined()
    })

    /*
     * The advanced entry supplies a name, and a name is only unique inside a
     * folder — without the scope a duplicate resolves to the oldest match
     * anywhere in the workspace.
     */
    it('sends the folder when append resolved the file by name', () => {
      const params = paramsFor('file_append', {
        appendFileInput: 'notes.md',
        appendContent: 'more',
        folderScopeRef: '/Reports',
      })

      expect(params.folderPath).toBe('/Reports')
    })

    it('carries the subfolder scope with a name-based append', () => {
      expect(
        paramsFor('file_append', {
          appendFileInput: 'notes.md',
          appendContent: 'more',
          folderScopeRef: '/Reports',
          folderIncludeSubfolders: 'false',
        }).includeSubfolders
      ).toBe(false)
    })

    it('still sends no folder when the pick carried an id', () => {
      expect(
        paramsFor('file_append', {
          appendFileInput: { id: 'wf_abc', name: 'notes.md' },
          appendContent: 'more',
          folderScopeRef: '/Reports',
        }).folderPath
      ).toBeUndefined()
    })

    it('appends by the picked file id, not its name', () => {
      expect(
        paramsFor('file_append', {
          appendFileInput: { id: 'wf_abc', name: 'notes.md' },
          appendContent: 'more',
        }).fileName
      ).toBe('wf_abc')
    })

    it('falls back to the name when the pick carries no id', () => {
      expect(
        paramsFor('file_append', {
          appendFileInput: { name: 'notes.md' },
          appendContent: 'more',
        }).fileName
      ).toBe('notes.md')
    })
  })

  /*
   * file.ts defines five block versions whose params transformers share the same
   * branch shapes, so an edit aimed at v5 lands on a legacy version just as
   * easily — which happened twice while building this. Pin the folder work to
   * v5 and off its predecessors.
   */
  describe('folder support belongs to v5 only', () => {
    it('leaves the superseded v4 block without folder params', () => {
      const transform = FileV4Block.tools.config?.params
      if (!transform) throw new Error('file_v4 has no params transformer')
      const params = transform({
        operation: 'file_write',
        fileName: 'data.csv',
        content: 'a,b',
        writeFolderRef: '/Reports',
        _context: { workspaceId: 'ws-1' },
      })

      expect(params.folderPath).toBeUndefined()
    })
  })

  /*
   * A folder is a scope on a file operation, not an operation of its own. The
   * picker beside it only offers files inside it, so a picked file is always
   * the narrower answer and the folder does not need to travel too.
   */
  describe('a folder scopes read, get content, and compress', () => {
    it.each([
      ['file_read', 'readFileInput'],
      ['file_get_content', 'getContentInput'],
      ['file_compress', 'compressInput'],
    ])('%s sends the picked files alone', (operation, inputId) => {
      const params = paramsFor(operation, {
        [inputId]: '["wf_a","wf_b"]',
        folderScopeRef: '/Reports',
      })

      expect(params.fileId).toEqual(['wf_a', 'wf_b'])
      expect(params.folderPaths).toBeUndefined()
    })

    it.each(['file_read', 'file_get_content', 'file_compress'])(
      '%s stands for the folder when no file is picked',
      (operation) => {
        const params = paramsFor(operation, { folderScopeRef: '/Reports' })

        expect(params.folderPaths).toEqual(['/Reports'])
        expect(params.fileId).toBeUndefined()
        expect(params.fileInput).toBeUndefined()
      }
    )

    it('refuses an operation with neither a file nor a folder', () => {
      expect(() => paramsFor('file_read', {})).toThrow(/File or folder is required for read/)
      expect(() => paramsFor('file_compress', {})).toThrow(
        /File or folder is required for compress/
      )
    })

    it('reads the workspace root as no scope at all', () => {
      expect(() => paramsFor('file_read', { folderScopeRef: '/' })).toThrow(
        /File or folder is required/
      )
    })

    /*
     * The default has to survive being absent: a folder normally stands for
     * everything under it, so only the off case is worth putting on the wire.
     */
    it('says nothing about scope while subfolders are included', () => {
      expect(
        paramsFor('file_read', { folderScopeRef: '/Reports' }).includeSubfolders
      ).toBeUndefined()
      expect(
        paramsFor('file_read', { folderScopeRef: '/Reports', folderIncludeSubfolders: 'true' })
          .includeSubfolders
      ).toBeUndefined()
    })

    it.each(['file_read', 'file_get_content', 'file_compress'])(
      '%s narrows to direct files when subfolders are switched off',
      (operation) => {
        expect(
          paramsFor(operation, {
            folderScopeRef: '/Reports',
            folderIncludeSubfolders: 'false',
          }).includeSubfolders
        ).toBe(false)
      }
    )

    it('carries the archive name on compress', () => {
      expect(
        paramsFor('file_compress', { folderScopeRef: '/Reports', archiveName: 'reports.zip' })
          .archiveName
      ).toBe('reports.zip')
    })
  })

  /*
   * The picker has to describe the same set the run reads, or a user can build
   * a selection the operation then ignores. That wiring is config, and getting
   * it wrong is silent.
   */
  describe('the file pickers are scoped by the folder beside them', () => {
    it.each(['readFile', 'getContentFile', 'compressFile', 'appendFile'])(
      '%s follows the folder',
      (pickerId) => {
        const picker = FileV5Block.subBlocks.find((subBlock) => subBlock.id === pickerId)

        expect(picker?.folderScope).toEqual({
          fieldId: 'folderSelection',
          recursiveFieldId: 'folderIncludeSubfolders',
        })
      }
    )

    /*
     * A folder that renders below the picker it narrows reads as a second
     * choice rather than a filter, so the order is load-bearing.
     */
    it.each(['readFile', 'getContentFile', 'compressFile', 'appendFile'])(
      'puts the folder above %s',
      (pickerId) => {
        const ids = FileV5Block.subBlocks.map((subBlock) => subBlock.id)

        expect(ids.indexOf('folderSelection')).toBeLessThan(ids.indexOf(pickerId))
      }
    )

    it('offers the folder on every operation whose picker it narrows', () => {
      const folder = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'folderSelection')

      expect(folder?.condition).toEqual({
        field: 'operation',
        value: ['file_read', 'file_get_content', 'file_compress', 'file_append'],
      })
    })

    it('leaves neither half of the choice individually required', () => {
      for (const pickerId of ['readFile', 'getContentFile', 'compressFile', 'folderSelection']) {
        expect(
          FileV5Block.subBlocks.find((subBlock) => subBlock.id === pickerId)?.required
        ).toBeUndefined()
      }
    })

    it('routes every folder field through the one tree control', () => {
      const pickers = FileV5Block.subBlocks.filter(
        (subBlock) => subBlock.type === 'sim-folder-tree-selector'
      )

      expect(pickers.map((subBlock) => subBlock.id).sort()).toEqual([
        'createParentPath',
        'destinationParentPath',
        'folderPath',
        'folderSelection',
        'moveTargetFolderPath',
        'writeFolderPath',
      ])
      for (const picker of pickers) {
        const pair = FileV5Block.subBlocks.filter(
          (subBlock) => subBlock.canonicalParamId === picker.canonicalParamId
        )
        expect(pair).toHaveLength(2)
        expect(pair.map((subBlock) => subBlock.mode).sort()).toEqual(['advanced', 'basic'])
      }
    })

    /*
     * Write names where before it names what. The order is the whole point of
     * the field, so it is worth pinning rather than trusting to a diff.
     */
    it('puts the write folder above the file name', () => {
      const ids = FileV5Block.subBlocks.map((subBlock) => subBlock.id)

      expect(ids.indexOf('writeFolderPath')).toBeLessThan(ids.indexOf('fileName'))
      expect(ids.indexOf('manualWriteFolderPath')).toBeLessThan(ids.indexOf('fileName'))
    })
  })
})
