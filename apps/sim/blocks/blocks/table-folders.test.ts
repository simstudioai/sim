/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  tableCreateFolderSchemas,
  tableDeleteFolderSchemas,
  tableListFoldersSchemas,
  tableMoveSchemas,
  tableRestoreFolderSchemas,
  tableUpdateFolderSchemas,
} from '@/lib/api/contracts/tools/table'
import { TableV2Block } from '@/blocks/blocks/table_v2'

/*
 * The block's params transformer feeds the tool dispatch directly, so its output
 * has to satisfy the same schema the dispatcher validates against. Testing the
 * two separately is what lets a blank text field ship as '' — a value the schema
 * rejects as a malformed path rather than reading as "not supplied".
 *
 * Every folder field is a canonical pair, so these pass the CANONICAL id
 * (`folderRef`, not `folderPath`): the serializer deletes the subblock ids and
 * republishes whichever member is active under the canonical one.
 */
function paramsFor(operation: string, extra: Record<string, unknown> = {}) {
  const transform = TableV2Block.tools.config?.params
  if (!transform) throw new Error('table_v2 has no params transformer')
  return transform({ operation, ...extra }) as Record<string, unknown>
}

function toolFor(operation: string): string {
  const resolve = TableV2Block.tools.config?.tool
  if (!resolve) throw new Error('table_v2 has no tool resolver')
  return resolve({ operation })
}

function subBlock(id: string) {
  return TableV2Block.subBlocks.find((entry) => entry.id === id)
}

/** Operation values a subblock's `condition` admits, as a list. */
function conditionValues(id: string): string[] {
  const condition = subBlock(id)?.condition
  if (!condition || typeof condition !== 'object' || !('value' in condition)) return []
  const value = (condition as { value: unknown }).value
  return Array.isArray(value) ? (value as string[]) : [value as string]
}

describe('table_v2 folder operations reach their tools', () => {
  it.each([
    ['list_folders', 'table_list_folders'],
    ['create_folder', 'table_create_folder'],
    ['update_folder', 'table_update_folder'],
    ['delete_folder', 'table_delete_folder'],
    ['restore_folder', 'table_restore_folder'],
    ['move', 'table_move'],
  ])('%s dispatches to %s', (operation, toolId) => {
    expect(toolFor(operation)).toBe(toolId)
    expect(TableV2Block.tools.access).toContain(toolId)
  })
})

describe('table_v2 folder operations produce schema-valid tool input', () => {
  it('omits a blank optional path instead of sending an empty string', () => {
    const params = paramsFor('list_folders', {
      folderRef: '',
      folderSearch: '',
      folderRecursive: false,
    })

    expect(params.path).toBeUndefined()
    expect(params.search).toBeUndefined()
    expect(tableListFoldersSchemas.body.safeParse(params).success).toBe(true)
  })

  it('accepts a switch set as the string a subblock can emit', () => {
    expect(paramsFor('list_folders', { folderRecursive: 'true' }).recursive).toBe(true)
    expect(
      paramsFor('delete_folder', { folderRef: '/A', deleteFolderRecursive: 'true' }).recursive
    ).toBe(true)
  })

  it('defaults the delete cascade to off, so a non-empty folder refuses to delete', () => {
    const params = paramsFor('delete_folder', { folderRef: '/Reports' })

    expect(params.recursive).toBe(false)
    expect(tableDeleteFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('coerces a typed depth and limit to numbers', () => {
    const params = paramsFor('list_folders', { folderDepth: '3', folderLimit: '50' })

    expect(params.depth).toBe(3)
    expect(params.limit).toBe(50)
    expect(tableListFoldersSchemas.body.safeParse(params).success).toBe(true)
  })

  it('composes a create path from the parent and the typed name', () => {
    const params = paramsFor('create_folder', {
      createParentRef: '/Reports',
      folderName: 'Q3 Results',
    })

    expect(params.path).toBe('/Reports/Q3%20Results')
    expect(tableCreateFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('creates at the workspace root when no parent is picked, without doubling the slash', () => {
    const params = paramsFor('create_folder', { createParentRef: '/', folderName: 'Reports' })

    expect(params.path).toBe('/Reports')
    expect(tableCreateFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('percent-encodes a slash inside a typed folder name rather than making it a level', () => {
    /* One folder genuinely named `Q3/Q4`, not a `Q3` holding a `Q4`. */
    const params = paramsFor('create_folder', { createParentRef: '/Reports', folderName: 'Q3/Q4' })

    expect(params.path).toBe('/Reports/Q3%2FQ4')
    expect(tableCreateFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('carries the folder name over to the destination when moving a folder', () => {
    const params = paramsFor('update_folder', {
      folderRef: '/Reports/Q3%20Results',
      destinationParentRef: '/Archive',
    })

    expect(params.path).toBe('/Reports/Q3%20Results')
    expect(params.destinationPath).toBe('/Archive/Q3%20Results')
    expect(tableUpdateFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('keeps a slash-in-name folder one level when moving it', () => {
    const params = paramsFor('update_folder', {
      folderRef: '/Reports/Q3%2FQ4',
      destinationParentRef: '/Archive',
    })

    expect(params.destinationPath).toBe('/Archive/Q3%2FQ4')
    expect(tableUpdateFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('moves a folder to the workspace root when no destination parent is picked', () => {
    const params = paramsFor('update_folder', {
      folderRef: '/Reports/Q3',
      destinationParentRef: '',
    })

    expect(params.destinationPath).toBe('/Q3')
    expect(tableUpdateFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('restores by the path the folder held when it was deleted', () => {
    const params = paramsFor('restore_folder', { restoreFolderPath: '/Reports/Q3' })

    expect(params.path).toBe('/Reports/Q3')
    expect(tableRestoreFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('sends a table move with its destination folder', () => {
    const params = paramsFor('move', { tableId: 'table-1', moveTargetRef: '/Reports' })

    expect(params).toMatchObject({ tableId: 'table-1', folderPath: '/Reports' })
    expect(tableMoveSchemas.body.safeParse(params).success).toBe(true)
  })

  it('leaves an unpicked move destination absent for the tool to read as the root', () => {
    /*
     * The tool substitutes the root rather than the block, because an omitted
     * `folderPath` reaching the update use case means "leave the folder alone".
     */
    const params = paramsFor('move', { tableId: 'table-1', moveTargetRef: '' })

    expect(params.folderPath).toBeUndefined()
    expect(tableMoveSchemas.body.safeParse(params).success).toBe(true)
  })
})

describe('table_v2 folder scope narrows the table picker', () => {
  it('renders the folder above the picker it narrows', () => {
    const ids = TableV2Block.subBlocks.map((entry) => entry.id)

    expect(ids.indexOf('folderSelection')).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf('folderSelection')).toBeLessThan(ids.indexOf('tableSelector'))
  })

  it('points the table picker at the folder field', () => {
    expect(subBlock('tableSelector')?.folderScope).toEqual({ fieldId: 'folderSelection' })
  })

  it('offers the folder on exactly the operations that pick a table', () => {
    expect(conditionValues('folderSelection')).toEqual(conditionValues('tableSelector'))
  })

  it('never sends the narrowing folder to a tool', () => {
    /*
     * It is a design-time filter on a dropdown, not a scope the run enforces —
     * so it must not appear in any tool input, and must not be declared as a
     * block input either.
     */
    const params = paramsFor('query_rows', { tableId: 'table-1', folderSelection: '/Reports' })

    expect(params.folderSelection).toBeUndefined()
    expect(TableV2Block.inputs).not.toHaveProperty('folderSelection')
  })

  it('has no advanced-mode twin, because a resolved reference would be discarded', () => {
    expect(subBlock('folderSelection')?.mode).toBe('basic')
    expect(subBlock('folderSelection')?.canonicalParamId).toBeUndefined()
    expect(
      TableV2Block.subBlocks.filter((entry) => entry.canonicalParamId === 'folderSelection')
    ).toHaveLength(0)
  })
})

describe('table_v2 folder subblocks are wired as canonical pairs', () => {
  it.each([
    ['folderPath', 'manualFolderPath', 'folderRef'],
    ['createParentPath', 'manualCreateParentPath', 'createParentRef'],
    ['destinationParentPath', 'manualDestinationParentPath', 'destinationParentRef'],
    ['moveTargetFolderPath', 'manualMoveTargetFolderPath', 'moveTargetRef'],
  ])('%s and %s share the canonical id %s', (basicId, manualId, canonicalId) => {
    expect(subBlock(basicId)?.canonicalParamId).toBe(canonicalId)
    expect(subBlock(manualId)?.canonicalParamId).toBe(canonicalId)
    expect(subBlock(basicId)?.mode).toBe('basic')
    expect(subBlock(manualId)?.mode).toBe('advanced')
    /* A canonical group must agree on required, or the serializer disagrees with the UI. */
    expect(subBlock(basicId)?.required).toEqual(subBlock(manualId)?.required)
  })

  it('picks the folder tree for tables, not another resource type', () => {
    for (const id of [
      'folderSelection',
      'folderPath',
      'createParentPath',
      'destinationParentPath',
      'moveTargetFolderPath',
    ]) {
      expect(subBlock(id)?.type).toBe('sim-folder-tree-selector')
      expect(subBlock(id)?.resourceType).toBe('table')
    }
  })

  it('addresses a deleted folder with plain text, since the tree only holds live folders', () => {
    expect(subBlock('restoreFolderPath')?.type).toBe('short-input')
  })
})

describe('table_v2 names every operation on the canvas', () => {
  it('has a sentence for each operation the dropdown offers', () => {
    const operations = (subBlock('operation')?.options ?? []) as Array<{ id: string }>
    const sentences = TableV2Block.canvasPresentation?.sentences?.byOperation ?? {}

    expect(operations.length).toBeGreaterThan(0)
    for (const option of operations) {
      expect(sentences).toHaveProperty(option.id)
    }
  })
})

/*
 * A block used as an Agent tool is handed the TOOL's schema, not this block's
 * subblock ids, so a model answers with `path` / `folderPath` while the canvas
 * stores `folderRef` / `moveTargetRef`. Reading only the canvas id dropped the
 * model's answer — and on move the tool's root fallback then turned "move into
 * /Reports" into "move to the root", silently.
 */
describe('table_v2 keeps the destination a model asked for', () => {
  it('moves the table where the model said, not to the workspace root', () => {
    const params = paramsFor('move', { tableId: 'table-1', folderPath: '/Reports' })

    expect(params.folderPath).toBe('/Reports')
    expect(tableMoveSchemas.body.safeParse(params).success).toBe(true)
  })

  it('lets the canvas destination win when the author picked one', () => {
    const params = paramsFor('move', {
      tableId: 'table-1',
      moveTargetRef: '/Archive',
      folderPath: '/Reports',
    })

    expect(params.folderPath).toBe('/Archive')
  })

  it('still reads an unset canvas destination as the workspace root', () => {
    /* No model answer either, so the tool's root fallback is the only signal. */
    expect(paramsFor('move', { tableId: 'table-1', moveTargetRef: '' }).folderPath).toBeUndefined()
  })

  it.each([
    ['list_folders', { path: '/Reports' }, 'path'],
    ['create_folder', { path: '/Reports/Q3' }, 'path'],
    ['delete_folder', { path: '/Reports' }, 'path'],
    ['restore_folder', { path: '/Reports/Q3' }, 'path'],
  ] as const)('carries a model-supplied path through %s', (operation, modelParams, field) => {
    expect(paramsFor(operation, modelParams)[field]).toBe(modelParams.path)
  })

  it('carries both ends of a model-driven folder move', () => {
    const params = paramsFor('update_folder', {
      path: '/Reports/Q3',
      destinationPath: '/Archive/Q3',
    })

    expect(params).toMatchObject({ path: '/Reports/Q3', destinationPath: '/Archive/Q3' })
    expect(tableUpdateFolderSchemas.body.safeParse(params).success).toBe(true)
  })

  it('keeps composing from the canvas when the author picked a source folder', () => {
    /* Canvas mode still moves to the root when no destination parent is set. */
    const params = paramsFor('update_folder', {
      folderRef: '/Reports/Q3',
      destinationParentRef: '',
      destinationPath: '/Ignored/Q3',
    })

    expect(params).toMatchObject({ path: '/Reports/Q3', destinationPath: '/Q3' })
  })

  it('carries model-supplied listing options', () => {
    const params = paramsFor('list_folders', {
      path: '/Reports',
      recursive: true,
      depth: 2,
      search: 'Q3',
      limit: 25,
    })

    expect(params).toMatchObject({ recursive: true, depth: 2, search: 'Q3', limit: 25 })
    expect(tableListFoldersSchemas.body.safeParse(params).success).toBe(true)
  })

  it('never takes the delete cascade from a model', () => {
    /*
     * `recursive` is user-only on the tool param AND on the subblock, so a model
     * answer must not reach the use case even if one is somehow present.
     */
    const params = paramsFor('delete_folder', { path: '/Reports', recursive: true })

    expect(params.recursive).toBe(false)
  })

  it('marks the delete cascade user-only on the subblock, not just the tool', () => {
    /* The block's own schema is what an Agent tool surface is built from. */
    expect(subBlock('deleteFolderRecursive')?.paramVisibility).toBe('user-only')
  })
})
