/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  knowledgeCreateFolderBodySchema,
  knowledgeDeleteFolderBodySchema,
  knowledgeListFoldersBodySchema,
  knowledgeUpdateFolderBodySchema,
} from '@/lib/api/contracts/knowledge/folders'
import { KnowledgeBlock } from '@/blocks/blocks/knowledge'

/*
 * The block's params transformer feeds the tool dispatch directly, so its output
 * has to satisfy the same schemas the dispatch validates against. Testing the
 * two separately is what let a blank text field ship as '' — a value the
 * contract rejects as a malformed path rather than reading as "not supplied".
 *
 * Every folder field is a canonical pair, so these pass the CANONICAL id
 * (`folderRef`, not `folderPath`): the serializer deletes the subblock ids and
 * republishes whichever member is active under the canonical one.
 */
function paramsFor(operation: string, extra: Record<string, unknown> = {}) {
  const transform = KnowledgeBlock.tools.config?.params
  if (!transform) throw new Error('knowledge has no params transformer')
  return transform({ operation, _context: { workspaceId: 'ws-1' }, ...extra })
}

describe('knowledge folder operations produce contract-valid tool input', () => {
  it('omits a blank optional path instead of sending an empty string', () => {
    const params = paramsFor('list_folders', {
      folderRef: '',
      folderSearch: '',
      folderRecursive: false,
    })

    expect(params.path).toBeUndefined()
    expect(params.search).toBeUndefined()
    expect(knowledgeListFoldersBodySchema.safeParse(params).success).toBe(true)
  })

  it('accepts a switch set as the string a subblock can emit', () => {
    expect(paramsFor('list_folders', { folderRecursive: 'true' }).recursive).toBe(true)
    expect(
      paramsFor('delete_folder', { folderRef: '/A', deleteFolderRecursive: 'true' }).recursive
    ).toBe(true)
  })

  it('coerces a typed depth and limit to numbers', () => {
    const params = paramsFor('list_folders', {
      folderRecursive: true,
      folderDepth: '3',
      folderLimit: '25',
    })

    expect(params.depth).toBe(3)
    expect(params.limit).toBe(25)
    expect(knowledgeListFoldersBodySchema.safeParse(params).success).toBe(true)
  })

  /*
   * Depth without recursion silently returned a shallower answer than asked for.
   * The contract refuses the pair, and the Max Depth field is gated on the
   * switch so the editor cannot build it either.
   */
  it('refuses a whitespace-only search rather than reading it as no search', () => {
    const params = paramsFor('list_folders', { folderSearch: '   ' })

    expect(knowledgeListFoldersBodySchema.safeParse(params).success).toBe(true)
    expect(knowledgeListFoldersBodySchema.safeParse({ ...params, search: '   ' }).success).toBe(
      false
    )
  })

  it('refuses a depth that would be silently ignored', () => {
    const params = paramsFor('list_folders', { folderDepth: '3' })

    expect(knowledgeListFoldersBodySchema.safeParse(params).success).toBe(false)
  })

  describe('create composes a path from a parent and a name', () => {
    it('encodes the typed name', () => {
      const params = paramsFor('create_folder', {
        createParentRef: '/Support',
        folderName: 'Tier 1',
      })

      expect(params.path).toBe('/Support/Tier%201')
      expect(knowledgeCreateFolderBodySchema.safeParse(params).success).toBe(true)
    })

    it('creates at the workspace root when no parent is picked', () => {
      expect(paramsFor('create_folder', { folderName: 'Support' }).path).toBe('/Support')
      expect(paramsFor('create_folder', { createParentRef: '/', folderName: 'Support' }).path).toBe(
        '/Support'
      )
    })

    /*
     * The path trap. A folder genuinely named `Q3/Q4` is ONE level, so the name
     * is encoded rather than allowed to split the path into two.
     */
    it('encodes a name containing a slash rather than splitting on it', () => {
      const params = paramsFor('create_folder', {
        createParentRef: '/Reports',
        folderName: 'Q3/Q4',
      })

      expect(params.path).toBe('/Reports/Q3%2FQ4')
      expect(knowledgeCreateFolderBodySchema.safeParse(params).success).toBe(true)
    })

    it('sends no path at all when the name is blank', () => {
      const params = paramsFor('create_folder', { createParentRef: '/Support', folderName: '  ' })

      expect(params.path).toBeUndefined()
      expect(knowledgeCreateFolderBodySchema.safeParse(params).success).toBe(false)
    })
  })

  describe('move composes a destination that does not exist yet', () => {
    it('moves into a folder, carrying the source name', () => {
      const params = paramsFor('update_folder', {
        folderRef: '/Support/Tier1',
        destinationParentRef: '/Archive',
      })

      expect(params).toMatchObject({ path: '/Support/Tier1', destinationPath: '/Archive/Tier1' })
      expect(knowledgeUpdateFolderBodySchema.safeParse(params).success).toBe(true)
    })

    it('moves to the workspace root when no parent is picked', () => {
      expect(paramsFor('update_folder', { folderRef: '/Support/Tier1' }).destinationPath).toBe(
        '/Tier1'
      )
    })

    it('preserves a source name that already contains an encoded slash', () => {
      const params = paramsFor('update_folder', {
        folderRef: '/Reports/Q3%2FQ4',
        destinationParentRef: '/Archive',
      })

      expect(params.destinationPath).toBe('/Archive/Q3%2FQ4')
      expect(knowledgeUpdateFolderBodySchema.safeParse(params).success).toBe(true)
    })
  })

  it('sends the delete guard off unless it was turned on', () => {
    expect(paramsFor('delete_folder', { folderRef: '/Support' })).toMatchObject({
      path: '/Support',
      recursive: false,
    })
    expect(
      knowledgeDeleteFolderBodySchema.safeParse(
        paramsFor('delete_folder', { folderRef: '/Support' })
      ).success
    ).toBe(true)
  })

  it('never asks a folder operation for a knowledge base', () => {
    for (const operation of ['list_folders', 'create_folder', 'update_folder', 'delete_folder']) {
      expect(() => paramsFor(operation, { folderRef: '/A', folderName: 'A' })).not.toThrow()
    }
  })
})

describe('a folder scopes search', () => {
  it('sends the folder when no knowledge base is picked', () => {
    const params = paramsFor('search', { searchFolderRef: '/Support', query: 'answer' })

    expect(params.folderPath).toBe('/Support')
    expect(params.knowledgeBaseId).toBeUndefined()
  })

  /*
   * Absent already means "this folder only", so only the on case travels — the
   * inverse of the File block, where a read scope descends unless told not to.
   */
  it('says nothing about subfolders unless they were asked for', () => {
    expect(
      paramsFor('search', { searchFolderRef: '/Support', query: 'q' }).folderIncludeSubfolders
    ).toBeUndefined()
    expect(
      paramsFor('search', {
        searchFolderRef: '/Support',
        searchFolderIncludeSubfolders: 'true',
        query: 'q',
      }).folderIncludeSubfolders
    ).toBe(true)
  })

  /*
   * Root is the absence of a selection, not a value: the tree offers no root
   * row, and "the whole workspace" is what the unfiltered picker already covers.
   * The error says so rather than claiming no folder was supplied, because one
   * was.
   */
  it('reads the workspace root as no scope at all, and says why', () => {
    expect(() => paramsFor('search', { searchFolderRef: '/', query: 'q' })).toThrow(
      'The workspace root is not a folder scope'
    )
  })

  /*
   * The picker only offers that folder's knowledge bases, so a picked one is the
   * narrower answer. Sending both would search the whole folder AND the pick —
   * wider than either, and the opposite of what the Folder field says it does.
   */
  it('drops the folder once a knowledge base is picked, rather than sending both', () => {
    const params = paramsFor('search', {
      searchFolderRef: '/Support',
      knowledgeBaseId: 'kb-1',
      query: 'q',
    })

    expect(params.knowledgeBaseId).toBe('kb-1')
    expect(params.folderPath).toBeUndefined()
  })

  it('refuses a search with neither a knowledge base nor a folder', () => {
    expect(() => paramsFor('search', { query: 'q' })).toThrow(
      'knowledge base or a folder is required'
    )
  })

  it('still requires a knowledge base on every other operation', () => {
    expect(() => paramsFor('list_documents', {})).toThrow('Knowledge base ID is required')
  })
})

/*
 * The picker has to describe the same set the run reads, or a user can build a
 * selection the operation then ignores. That wiring is config, and getting it
 * wrong is silent.
 */
describe('the knowledge base picker is scoped by the folder beside it', () => {
  it('follows the folder', () => {
    const picker = KnowledgeBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'knowledgeBaseSelector'
    )

    expect(picker?.folderScope).toEqual({
      fieldId: 'searchFolder',
      manualFieldId: 'manualSearchFolder',
      recursiveFieldId: 'searchFolderIncludeSubfolders',
    })
  })

  /*
   * Only one half of a canonical pair is ever filled. Naming just the basic id
   * would read as "no folder" for an advanced-mode user and the picker would
   * offer knowledge bases the folder excludes.
   */
  it('names both halves of the folder pair so advanced mode still narrows', () => {
    const picker = KnowledgeBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'knowledgeBaseSelector'
    )
    const pair = KnowledgeBlock.subBlocks
      .filter((subBlock) => subBlock.canonicalParamId === 'searchFolderRef')
      .map((subBlock) => subBlock.id)
      .sort()

    expect(pair).toEqual(['manualSearchFolder', 'searchFolder'])
    expect([picker?.folderScope?.fieldId, picker?.folderScope?.manualFieldId].sort()).toEqual(pair)
  })

  /*
   * A folder that renders below the picker it narrows reads as a second choice
   * rather than a filter, so the order is load-bearing.
   */
  it('puts the folder above the knowledge base picker', () => {
    const ids = KnowledgeBlock.subBlocks.map((subBlock) => subBlock.id)

    expect(ids.indexOf('searchFolder')).toBeLessThan(ids.indexOf('knowledgeBaseSelector'))
    expect(ids.indexOf('manualSearchFolder')).toBeLessThan(ids.indexOf('knowledgeBaseSelector'))
  })

  /*
   * Conditions read raw subblock values, never canonical param ids, so a guard
   * naming `searchFolderRef` matches nothing and the control renders always.
   */
  it('hides Include Subfolders until a folder is set, in either mode', () => {
    const subfolders = KnowledgeBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'searchFolderIncludeSubfolders'
    )
    const resolve = (values: Record<string, unknown>) =>
      typeof subfolders?.condition === 'function' ? subfolders.condition(values) : undefined

    expect(resolve({})?.and).toMatchObject({ field: 'searchFolder', value: '', not: true })
    expect(resolve({ manualSearchFolder: '/Support' })?.and).toMatchObject({
      field: 'manualSearchFolder',
      value: '',
      not: true,
    })
  })

  it('offers the folder only where it is a scope', () => {
    const folder = KnowledgeBlock.subBlocks.find((subBlock) => subBlock.id === 'searchFolder')

    expect(folder?.condition).toEqual({ field: 'operation', value: 'search' })
  })

  it('routes every folder field through the one tree control, each with a manual twin', () => {
    const pickers = KnowledgeBlock.subBlocks.filter(
      (subBlock) => subBlock.type === 'sim-folder-tree-selector'
    )

    expect(pickers.map((subBlock) => subBlock.id).sort()).toEqual([
      'createParentPath',
      'destinationParentPath',
      'folderPath',
      'searchFolder',
    ])
    for (const picker of pickers) {
      expect(picker.resourceType).toBe('knowledge_base')
      const pair = KnowledgeBlock.subBlocks.filter(
        (subBlock) => subBlock.canonicalParamId === picker.canonicalParamId
      )
      expect(pair).toHaveLength(2)
      expect(pair.map((subBlock) => subBlock.mode).sort()).toEqual(['advanced', 'basic'])
    }
  })

  it('leaves the knowledge base optional on search, where a folder can stand for it', () => {
    for (const id of ['knowledgeBaseSelector', 'manualKnowledgeBaseId']) {
      const required = KnowledgeBlock.subBlocks.find((subBlock) => subBlock.id === id)?.required
      expect(required).toMatchObject({ field: 'operation' })
      expect((required as { value: string[] }).value).not.toContain('search')
    }
  })

  it('hides the knowledge base picker on the folder operations', () => {
    const condition = KnowledgeBlock.subBlocks.find(
      (subBlock) => subBlock.id === 'knowledgeBaseSelector'
    )?.condition as { value: string[] }

    for (const operation of ['list_folders', 'create_folder', 'update_folder', 'delete_folder']) {
      expect(condition.value).not.toContain(operation)
    }
  })
})
