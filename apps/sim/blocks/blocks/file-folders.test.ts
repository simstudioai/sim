import { describe, expect, it } from 'vitest'
import {
  fileManageCreateFolderBodySchema,
  fileManageDeleteFolderBodySchema,
  fileManageRestoreFolderBodySchema,
  fileManageUpdateFolderBodySchema,
} from '@/lib/api/contracts/tools/file'
import { FileV5Block } from '@/blocks/blocks/file'

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

    it('encodes a name containing a slash rather than splitting on it', () => {
      expect(paramsFor('file_create_folder', { folderName: 'Q3/Q4' }).path).toBe('/Q3%2FQ4')
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

    it('preserves a source name that already contains an encoded slash', () => {
      expect(
        paramsFor('file_update_folder', {
          folderRef: '/Q3%2FQ4',
          destinationParentRef: '/Archive',
        }).destinationPath
      ).toBe('/Archive/Q3%2FQ4')
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

    it('sends every selected folder when a name is scoped to several folders', () => {
      const params = paramsFor('file_append', {
        appendFileInput: 'notes.md',
        appendContent: 'more',
        folderScopeRef: ['/Reports', '/Archive'],
      })

      expect(params.folderPath).toBeUndefined()
      expect(params.folderPaths).toEqual(['/Reports', '/Archive'])
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
  })

  /*
   * The advanced half of the scope pair is typed, so the scope can arrive as
   * text: one path, a comma-separated list, or the JSON array an earlier picker
   * revision serialized. All three have to resolve to the canonical scopes a
   * picked folder produces, on every operation the scope applies to.
   */
  describe('a typed scope reads like a picked one', () => {
    it('keeps a percent-encoded comma inside one folder name', () => {
      expect(paramsFor('file_read', { folderScopeRef: '/Q3%2CQ4' }).folderPaths).toEqual([
        '/Q3%2CQ4',
      ])
    })
  })

  /*
   * The picker has to describe the same set the run reads, or a user can build
   * a selection the operation then ignores. That wiring is config, and getting
   * it wrong is silent.
   */
  describe('the file pickers are scoped by the folder beside them', () => {
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

      it('refuses a line number that is not a whole number above zero', () => {
        expect(() =>
          paramsFor('file_get_content', { getContentInput: 'wf_abc', contentOffset: '0' })
        ).toThrow(/whole number/)
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
    })

    describe('search takes the folder as a filter, not a selection', () => {
      it('confines the search to a chosen folder', () => {
        const params = paramsFor('file_search', {
          query: 'commitment',
          folderScopeRef: '/memory/user-a',
        })

        expect(params.folderPaths).toEqual(['/memory/user-a'])
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
    })
  })
})
