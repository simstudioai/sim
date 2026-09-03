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

/**
 * The block's params transformer feeds the tool route directly, so its output
 * has to satisfy the same contract the route validates against. Testing the two
 * separately is what let a blank text field ship as '' — a value the contract
 * rejects as a malformed path rather than reading as "not supplied".
 *
 * Every folder field is a canonical pair, so these pass the CANONICAL id
 * (`folderRef`, not `folderPath`; `folderScopeRef`, not `folderSelection`): the
 * serializer deletes the subblock ids and republishes whichever member is
 * active under the canonical one.
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
        moveFileInput: 'wf_123',
        moveTargetRef: '/Reports/Q3%20Results',
      })

      expect(params.fileId).toBe('wf_123')
      expect(params.folderPath).toBe('/Reports/Q3%20Results')
      expect(fileManageMoveBodySchema.safeParse({ operation: 'move', ...params }).success).toBe(
        true
      )
    })

    it('omits the destination when no folder is picked', () => {
      const params = paramsFor('file_move', { moveFileInput: 'wf_123' })

      expect(params.folderPath).toBeUndefined()
      expect(fileManageMoveBodySchema.safeParse({ operation: 'move', ...params }).success).toBe(
        true
      )
    })

    /*
     * The file is a basic/advanced pair like every other single-file operand,
     * so it can be picked as well as typed. The tool takes only an id, so a
     * picked file travels as the id its selection carries.
     */
    it('pairs a workspace file picker with the typed id', () => {
      const picker = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'moveFile')
      const typed = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'moveFileId')

      expect(picker?.type).toBe('file-upload')
      expect(picker?.mode).toBe('basic')
      expect(picker?.canonicalParamId).toBe('moveFileInput')
      expect(typed?.type).toBe('short-input')
      expect(typed?.mode).toBe('advanced')
      expect(typed?.canonicalParamId).toBe('moveFileInput')
      expect(typed?.condition).toEqual(picker?.condition)
      expect(typed?.required).toEqual(picker?.required)
    })

    it('moves a picked file by the id it carries', () => {
      const params = paramsFor('file_move', {
        moveFileInput: { id: 'wf_abc', name: 'notes.md', key: 'workspace/ws-1/notes.md' },
      })

      expect(params.fileId).toBe('wf_abc')
      expect(fileManageMoveBodySchema.safeParse({ operation: 'move', ...params }).success).toBe(
        true
      )
    })

    it('reads one id from the serialized list a reference can produce', () => {
      expect(paramsFor('file_move', { moveFileInput: '["wf_abc"]' }).fileId).toBe('wf_abc')
    })

    it('refuses more than one file', () => {
      expect(() => paramsFor('file_move', { moveFileInput: '["wf_a","wf_b"]' })).toThrow(
        /single file/
      )
      expect(() =>
        paramsFor('file_move', { moveFileInput: [{ id: 'wf_a' }, { id: 'wf_b' }] })
      ).toThrow(/single file/)
    })

    it('refuses a file object that carries no id, naming the remedy', () => {
      expect(() =>
        paramsFor('file_move', { moveFileInput: { name: 'notes.md', key: 'k' } })
      ).toThrow(/workspace file ID/)
    })

    it('refuses an empty operand', () => {
      expect(() => paramsFor('file_move', {})).toThrow(/File is required for move/)
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

    it('sends every selected folder when a name is scoped to several folders', () => {
      const params = paramsFor('file_append', {
        appendFileInput: 'notes.md',
        appendContent: 'more',
        folderScopeRef: ['/Reports', '/Archive'],
      })

      expect(params.folderPath).toBeUndefined()
      expect(params.folderPaths).toEqual(['/Reports', '/Archive'])
    })

    it('carries the narrowed scope with a name-based append', () => {
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

    it('sends every selected folder for a folder-only read', () => {
      expect(
        paramsFor('file_read', { folderScopeRef: ['/Reports', '/Archive'] }).folderPaths
      ).toEqual(['/Reports', '/Archive'])
    })

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
        paramsFor('file_read', {
          folderScopeRef: '/Reports',
          folderIncludeSubfolders: 'true',
        }).includeSubfolders
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
   * The advanced half of the scope pair is typed, so the scope can arrive as
   * text: one path, a comma-separated list, or the JSON array an earlier picker
   * revision serialized. All three have to resolve to the canonical scopes a
   * picked folder produces, on every operation the scope applies to.
   */
  describe('a typed scope reads like a picked one', () => {
    it('reads a comma-separated list on a folder-only read', () => {
      expect(paramsFor('file_read', { folderScopeRef: '/Reports, /Archive' }).folderPaths).toEqual([
        '/Reports',
        '/Archive',
      ])
    })

    it('confines a search to every typed folder', () => {
      expect(
        paramsFor('file_search', {
          query: 'commitment',
          folderScopeRef: '/memory/user-a,/memory/user-b',
        }).folderPaths
      ).toEqual(['/memory/user-a', '/memory/user-b'])
    })

    it('scopes a named edit to the typed folders', () => {
      const params = paramsFor('file_edit', {
        editFileInput: 'self.md',
        editMode: 'search_replace',
        editSearch: 'a',
        editContent: 'b',
        folderScopeRef: '/memory/user-a, /memory/shared',
      })

      expect(params.folderPath).toBeUndefined()
      expect(params.folderPaths).toEqual(['/memory/user-a', '/memory/shared'])
    })

    it('keeps a percent-encoded comma inside one folder name', () => {
      expect(paramsFor('file_read', { folderScopeRef: '/Q3%2CQ4' }).folderPaths).toEqual([
        '/Q3%2CQ4',
      ])
    })

    it('still reads the array an earlier picker revision serialized', () => {
      expect(
        paramsFor('file_read', { folderScopeRef: '["/Reports","/Archive"]' }).folderPaths
      ).toEqual(['/Reports', '/Archive'])
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

    /*
     * The scope is a basic/advanced pair like every other folder field, so a
     * path can be typed or come from an earlier block. A per-user memory folder
     * such as /memory/<start.userId> is only expressible that way.
     */
    it('pairs the multi-folder picker with a typed twin', () => {
      const folder = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'folderSelection')
      const typed = FileV5Block.subBlocks.find((s) => s.id === 'manualFolderSelection')

      expect(folder?.mode).toBe('basic')
      expect(folder?.multiSelect).toBe(true)
      expect(folder?.canonicalParamId).toBe('folderScopeRef')
      expect(typed?.mode).toBe('advanced')
      expect(typed?.type).toBe('short-input')
      expect(typed?.canonicalParamId).toBe('folderScopeRef')
      expect(typed?.condition).toEqual(folder?.condition)
    })

    it('keeps the recursion switch out of the pair, in additional fields', () => {
      const folder = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'folderSelection')
      const recursive = FileV5Block.subBlocks.find((s) => s.id === 'folderIncludeSubfolders')

      expect(recursive?.mode).toBe('advanced')
      expect(recursive?.canonicalParamId).toBeUndefined()
      expect(recursive?.condition).toEqual(folder?.condition)
    })

    it('offers the folder on every operation whose picker it narrows', () => {
      const folder = FileV5Block.subBlocks.find((subBlock) => subBlock.id === 'folderSelection')

      expect(folder?.condition).toEqual({
        field: 'operation',
        value: [
          'file_read',
          'file_get_content',
          'file_compress',
          'file_append',
          'file_search',
          'file_edit',
        ],
      })
    })

    /*
     * Every one of these was declared in a contract and then not sent. A field
     * the block never emits is indistinguishable from a feature that does not
     * exist, which is the failure mode this group exists to catch.
     */
    describe('the fields the contracts declare actually travel', () => {
      it('sends the recursion flag with edit, so a nested same-named file stays out of scope', () => {
        const params = paramsFor('file_edit', {
          editFileInput: 'self.md',
          editMode: 'search_replace',
          editSearch: 'a',
          editContent: 'b',
          folderScopeRef: '/memory/user-a',
          folderIncludeSubfolders: 'false',
        })

        expect(params.folderPath).toBe('/memory/user-a')
        expect(params.includeSubfolders).toBe(false)
      })

      it('sends a requested line range on get content', () => {
        const params = paramsFor('file_get_content', {
          getContentInput: 'wf_abc',
          contentOffset: '10',
          contentLimit: '5',
        })

        expect(params.offset).toBe(10)
        expect(params.limit).toBe(5)
      })

      it('omits the range when neither bound is set', () => {
        const params = paramsFor('file_get_content', { getContentInput: 'wf_abc' })

        expect(params.offset).toBeUndefined()
        expect(params.limit).toBeUndefined()
      })

      it('refuses a line number that is not a whole number above zero', () => {
        expect(() =>
          paramsFor('file_get_content', { getContentInput: 'wf_abc', contentOffset: '0' })
        ).toThrow(/whole number/)
      })

      it('coerces the anchor occurrence, which arrives from the input as text', () => {
        const params = paramsFor('file_edit', {
          editFileInput: 'wf_abc',
          editMode: 'insert_after',
          anchor: '## Notes',
          editContent: 'x',
          editOccurrence: '2',
        })

        expect(params.occurrence).toBe(2)
      })
    })

    /*
     * A named target inside a scope refuses a duplicate name and lists the
     * candidates; with no scope the workspace-wide lookup silently takes the
     * oldest. So the root must survive for a named target even though it is
     * dropped for a whole-folder read, where it means the same as no scope.
     */
    describe('the root survives as a scope for a named target', () => {
      it.each([
        ['file_append', { appendFileInput: 'self.md', appendContent: 'x' }],
        [
          'file_edit',
          {
            editFileInput: 'self.md',
            editMode: 'search_replace',
            editSearch: 'a',
            editContent: 'b',
          },
        ],
      ])('keeps the root on %s, so a duplicate name is refused not guessed', (operation, extra) => {
        const recursive = paramsFor(operation, { ...extra, folderScopeRef: '/' })
        const shallow = paramsFor(operation, {
          ...extra,
          folderScopeRef: '/',
          folderIncludeSubfolders: 'false',
        })

        expect(recursive.folderPath).toBe('/')
        expect(recursive.includeSubfolders).toBeUndefined()
        expect(shallow.folderPath).toBe('/')
        expect(shallow.includeSubfolders).toBe(false)
      })

      it('still drops the folder when the file was picked by id', () => {
        const params = paramsFor('file_append', {
          appendFileInput: { id: 'wf_abc', name: 'self.md' },
          appendContent: 'x',
          folderScopeRef: '/',
        })

        expect(params.folderPath).toBeUndefined()
      })
    })

    describe('search takes the folder as a filter, not a selection', () => {
      it('searches the workspace when no folder is chosen', () => {
        const params = paramsFor('file_search', { query: 'commitment' })

        expect(params.folderPaths).toBeUndefined()
        expect(params.includeSubfolders).toBeUndefined()
      })

      it('confines the search to a chosen folder', () => {
        const params = paramsFor('file_search', {
          query: 'commitment',
          folderScopeRef: '/memory/user-a',
        })

        expect(params.folderPaths).toEqual(['/memory/user-a'])
      })

      it('confines the search to every chosen folder', () => {
        const params = paramsFor('file_search', {
          query: 'commitment',
          folderScopeRef: ['/memory/user-a', '/memory/user-b'],
        })

        expect(params.folderPaths).toEqual(['/memory/user-a', '/memory/user-b'])
      })

      it('treats the workspace root as no scope at all', () => {
        const params = paramsFor('file_search', { query: 'commitment', folderScopeRef: '/' })

        expect(params.folderPaths).toBeUndefined()
      })

      it('sends the narrow scope only when subfolders are switched off', () => {
        const recursive = paramsFor('file_search', {
          query: 'commitment',
          folderScopeRef: '/memory/user-a',
        })
        const shallow = paramsFor('file_search', {
          query: 'commitment',
          folderScopeRef: '/memory/user-a',
          folderIncludeSubfolders: 'false',
        })

        expect(recursive.folderPaths).toEqual(['/memory/user-a'])
        expect(recursive.includeSubfolders).toBeUndefined()
        expect(shallow.includeSubfolders).toBe(false)
      })

      it('does not send a recursion flag with no folder to apply it to', () => {
        const params = paramsFor('file_search', {
          query: 'commitment',
        })

        expect(params.includeSubfolders).toBeUndefined()
      })
    })

    it('leaves neither half of the choice individually required', () => {
      for (const pickerId of [
        'readFile',
        'getContentFile',
        'compressFile',
        'folderSelection',
        'manualFolderSelection',
      ]) {
        expect(
          FileV5Block.subBlocks.find((subBlock) => subBlock.id === pickerId)?.required
        ).toBeUndefined()
      }
    })

    it('routes every workspace folder field through the canonical selector', () => {
      const pickers = FileV5Block.subBlocks.filter(
        (subBlock) => subBlock.type === 'folder-selector' && subBlock.resourceType === 'file'
      )

      expect(pickers.map((subBlock) => subBlock.id).sort()).toEqual([
        'createParentPath',
        'destinationParentPath',
        'folderPath',
        'folderSelection',
        'moveTargetFolderPath',
        'writeFolderPath',
      ])
      /**
       * Every picker is half of a basic/advanced pair, so a path can also be
       * typed.
       */
      for (const picker of pickers) {
        const pair = FileV5Block.subBlocks.filter(
          (subBlock) => subBlock.canonicalParamId === picker.canonicalParamId
        )
        expect(pair).toHaveLength(2)
        expect(pair.map((subBlock) => subBlock.mode).sort()).toEqual(['advanced', 'basic'])
      }
    })

    it('puts the write folder above the file name', () => {
      const ids = FileV5Block.subBlocks.map((subBlock) => subBlock.id)

      expect(ids.indexOf('writeFolderPath')).toBeLessThan(ids.indexOf('fileName'))
      expect(ids.indexOf('manualWriteFolderPath')).toBeLessThan(ids.indexOf('fileName'))
    })
  })
})
