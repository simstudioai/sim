/**
 * @vitest-environment jsdom
 *
 * Coverage for the payload {@link useForkSync} actually submits, not just the helpers it calls.
 * The tests distinguish a genuine provider change, which must clear unresolved descendants,
 * from a provider undo, which must restore them before Save or Sync derives its payload.
 */
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ForkDependentReconfig,
  ForkMappingEntry,
  UpdateForkMappingBody,
} from '@/lib/api/contracts/workspace-fork'

const {
  mockUseForkMapping,
  mockUseForkDiff,
  mockUpdateMutate,
  mockUpdateMutateAsync,
  mockPromote,
} = vi.hoisted(() => ({
  mockUseForkMapping: vi.fn(),
  mockUseForkDiff: vi.fn(),
  mockUpdateMutate: vi.fn(),
  mockUpdateMutateAsync: vi.fn(),
  mockPromote: vi.fn(),
}))

vi.mock('@sim/emcn', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/ee/workspace-forking/hooks/workspace-fork', () => ({
  useForkMapping: mockUseForkMapping,
  useForkDiff: mockUseForkDiff,
  useUpdateForkMapping: () => ({
    mutate: mockUpdateMutate,
    mutateAsync: mockUpdateMutateAsync,
    isPending: false,
  }),
  usePromoteFork: () => ({ mutateAsync: mockPromote }),
}))

import {
  applyDependentRepick,
  dependentKey,
} from '@/ee/workspace-forking/components/fork-sync/dependent-value'
import {
  type ForkSyncController,
  shouldReconfigureEntry,
  useForkSync,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'

const WORKSPACE_ID = 'ws-child'
const OTHER_WORKSPACE_ID = 'ws-parent'
const WORKFLOW_ID = 'wf-1'
const BLOCK_ID = 'block-1'

/** The mapped credential every dependent below hangs off; already mapped, so nothing re-picks it. */
const CREDENTIAL_ENTRY: ForkMappingEntry = {
  kind: 'credential',
  resourceType: 'credential',
  sourceId: 'cred-src',
  sourceLabel: 'Google (source)',
  targetId: 'cred-tgt',
  suggested: false,
  required: true,
  sourceDeleted: false,
  candidates: [],
  candidatesTruncated: false,
}

function dependent(overrides: Partial<ForkDependentReconfig>): ForkDependentReconfig {
  return {
    parentKind: 'credential',
    parentSourceId: CREDENTIAL_ENTRY.sourceId,
    parentContextKey: 'oauthCredential',
    targetWorkflowId: WORKFLOW_ID,
    targetBlockId: BLOCK_ID,
    blockName: 'Google Sheets',
    subBlockKey: 'field',
    selectorKey: 'sheet',
    title: 'Field',
    currentValue: '',
    sourceValue: '',
    required: false,
    consumesContextKeys: [],
    context: {},
    ...overrides,
  }
}

/** The in-block provider the user re-picks; its change invalidates `CHILD`. */
const PARENT_FIELD = dependent({
  subBlockKey: 'spreadsheetId',
  title: 'Spreadsheet',
  currentValue: 'sheet-1',
  providesContextKey: 'spreadsheetId',
})

/** Optional descendant of `PARENT_FIELD` - the field the P0 used to blank in the target. */
const CHILD_FIELD = dependent({
  subBlockKey: 'sheetName',
  title: 'Sheet',
  currentValue: 'Tab A',
  consumesContextKeys: ['spreadsheetId'],
})

/** Unrelated field the user clears themselves; an intentional clear must still be submitted. */
const CLEARED_FIELD = dependent({
  subBlockKey: 'folderId',
  title: 'Folder',
  currentValue: 'folder-9',
})

/** Untouched field, submitted with its stored value so the "full stored mapping" contract holds. */
const UNTOUCHED_FIELD = dependent({
  subBlockKey: 'labelId',
  title: 'Label',
  currentValue: 'label-3',
})

const DEPENDENTS = [PARENT_FIELD, CHILD_FIELD, CLEARED_FIELD, UNTOUCHED_FIELD]

const SUCCESSFUL_PROMOTE_RESULT = {
  promoteRunId: 'run-1',
  blockers: [],
  unmappedRequired: [],
  droppedReferences: [],
  triggerUrlChanges: [],
  deployFailed: 0,
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const mappedRepickContext = (previousValue: string) => ({
  previousValue,
  baselineValueFor: (field: ForkDependentReconfig) => field.currentValue,
})

function diffData(dependentReconfigs: ForkDependentReconfig[]) {
  return {
    sourceWorkspaceId: WORKSPACE_ID,
    targetWorkspaceId: OTHER_WORKSPACE_ID,
    workflows: [],
    dependentReconfigs,
    resourceUsages: [],
    copyableUnmapped: [],
    clearedRefs: [],
    triggerMappings: [],
    retiringTriggerUrls: [],
    excludedSourceWorkflows: [],
    excludedTargetWorkflows: [],
    mcpReauthServerIds: [],
    inlineSecretSources: [],
  }
}

const mountedRoots: Root[] = []

function renderForkSync(): { get: () => ForkSyncController } {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const container = document.createElement('div')
  const root = createRoot(container)
  mountedRoots.push(root)
  let result: ForkSyncController | undefined

  function Probe() {
    result = useForkSync({
      workspaceId: WORKSPACE_ID,
      otherWorkspaceId: OTHER_WORKSPACE_ID,
      otherWorkspaceName: 'Parent',
      direction: 'push',
      enabled: true,
    })
    return null
  }

  act(() => {
    root.render((<Probe />) as ReactNode)
  })

  return {
    get: () => {
      if (!result) throw new Error('hook result is not ready')
      return result
    },
  }
}

/** The `dependentValues` the last Save sent, or `undefined` when it sent none. */
function savedDependentValues(): UpdateForkMappingBody['dependentValues'] {
  expect(mockUpdateMutate).toHaveBeenCalledTimes(1)
  const [variables] = mockUpdateMutate.mock.calls[0] as [{ body: UpdateForkMappingBody }]
  return variables.body.dependentValues
}

/** The `dependentValues` the last Sync promoted. */
function promotedDependentValues(): UpdateForkMappingBody['dependentValues'] {
  expect(mockPromote).toHaveBeenCalledTimes(1)
  const [variables] = mockPromote.mock.calls[0] as [
    { body: { dependentValues?: UpdateForkMappingBody['dependentValues'] } },
  ]
  return variables.body.dependentValues
}

function valueFor(
  submitted: UpdateForkMappingBody['dependentValues'],
  field: ForkDependentReconfig
): string | undefined {
  return submitted?.find((entry) => entry.subBlockKey === field.subBlockKey)?.value
}

beforeEach(() => {
  vi.clearAllMocks()
  mockUseForkMapping.mockReturnValue({
    data: { entries: [CREDENTIAL_ENTRY] },
    isLoading: false,
    isError: false,
    error: null,
    isPlaceholderData: false,
  })
  mockUseForkDiff.mockReturnValue({
    data: diffData(DEPENDENTS),
    isError: false,
    error: null,
    isPlaceholderData: false,
  })
  mockUpdateMutateAsync.mockResolvedValue({ success: true, updated: 1 })
  mockPromote.mockResolvedValue(SUCCESSFUL_PROMOTE_RESULT)
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

describe('useForkSync dependent payload', () => {
  it('submits an effective blank for an optional dependent invalidated by a real provider change', () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          PARENT_FIELD,
          DEPENDENTS,
          'sheet-2',
          mappedRepickContext('sheet-1')
        )
      )
    })

    expect(get().reconfig[dependentKey(CHILD_FIELD)]).toBeNull()

    act(() => get().save())

    const submitted = savedDependentValues()
    expect(submitted?.map((entry) => entry.subBlockKey)).toEqual([
      PARENT_FIELD.subBlockKey,
      CHILD_FIELD.subBlockKey,
      CLEARED_FIELD.subBlockKey,
      UNTOUCHED_FIELD.subBlockKey,
    ])
    expect(valueFor(submitted, PARENT_FIELD)).toBe('sheet-2')
    expect(valueFor(submitted, CHILD_FIELD)).toBe('')
    expect(valueFor(submitted, UNTOUCHED_FIELD)).toBe('label-3')
  })

  it('submits a field the user cleared themselves, so an intentional clear still clears the target', () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) => ({ ...prev, [dependentKey(CLEARED_FIELD)]: '' }))
    })
    act(() => get().save())

    const submitted = savedDependentValues()
    expect(submitted?.map((entry) => entry.subBlockKey)).toContain(CLEARED_FIELD.subBlockKey)
    expect(valueFor(submitted, CLEARED_FIELD)).toBe('')
  })

  it('restores the dependent chain when the provider re-pick is undone', () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          PARENT_FIELD,
          DEPENDENTS,
          'sheet-2',
          mappedRepickContext('sheet-1')
        )
      )
    })
    expect(get().dirty).toBe(true)

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          PARENT_FIELD,
          DEPENDENTS,
          'sheet-1',
          mappedRepickContext('sheet-2')
        )
      )
    })

    expect(get().reconfig).toEqual({})
    expect(get().dirty).toBe(false)

    act(() => get().save())
    expect(mockUpdateMutate).not.toHaveBeenCalled()
  })

  it('keeps Sync blocked while a REQUIRED dependent is marked by a parent re-pick', () => {
    const requiredChild = { ...CHILD_FIELD, required: true }
    mockUseForkDiff.mockReturnValue({
      data: diffData([PARENT_FIELD, requiredChild]),
      isError: false,
      error: null,
      isPlaceholderData: false,
    })
    const { get } = renderForkSync()

    expect(get().syncDisabled).toBe(false)

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          PARENT_FIELD,
          [PARENT_FIELD, requiredChild],
          'sheet-2',
          mappedRepickContext('sheet-1')
        )
      )
    })

    expect(get().syncDisabled).toBe(true)
    expect(get().syncDisabledReason).toBe('Reconfigure all required fields first')

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          PARENT_FIELD,
          [PARENT_FIELD, requiredChild],
          'sheet-1',
          mappedRepickContext('sheet-2')
        )
      )
    })

    expect(get().reconfig).toEqual({})
    expect(get().syncDisabled).toBe(false)
  })

  it('submits the invalidated dependent as blank in the promote payload too', async () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          PARENT_FIELD,
          DEPENDENTS,
          'sheet-2',
          mappedRepickContext('sheet-1')
        )
      )
    })
    await act(async () => {
      await get().sync()
    })

    expect(valueFor(promotedDependentValues(), CHILD_FIELD)).toBe('')
  })

  it('clears a stale nested Agent tool child when its provider changes', async () => {
    const project = dependent({
      subBlockKey: 'tools[0].projectId',
      dependencyScope: 'tools[0]',
      currentValue: 'project-old',
      providesContextKey: 'projectId',
    })
    const issue = dependent({
      subBlockKey: 'tools[0].issueKey',
      dependencyScope: 'tools[0]',
      currentValue: 'OLD-1',
      consumesContextKeys: ['projectId'],
    })
    mockUseForkDiff.mockReturnValue({
      data: diffData([project, issue]),
      isError: false,
      error: null,
      isPlaceholderData: false,
    })
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          project,
          [project, issue],
          'project-new',
          mappedRepickContext('project-old')
        )
      )
    })
    await act(async () => {
      await get().sync()
    })

    expect(valueFor(promotedDependentValues(), project)).toBe('project-new')
    expect(valueFor(promotedDependentValues(), issue)).toBe('')
  })
})

describe('useForkSync post-sync reset', () => {
  it('drops the in-session re-picks once the sync commits them', async () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          PARENT_FIELD,
          DEPENDENTS,
          'sheet-2',
          mappedRepickContext('sheet-1')
        )
      )
    })
    expect(get().dirty).toBe(true)

    await act(async () => {
      await get().sync()
    })

    expect(get().reconfig).toEqual({})
    expect(get().dirty).toBe(false)
  })

  it('keeps the in-session re-picks when the sync is refused by the server gate', async () => {
    mockPromote.mockResolvedValue({
      promoteRunId: null,
      blockers: [{ kind: 'credential', sourceId: 'cred-src' }],
      unmappedRequired: [],
      droppedReferences: [],
      triggerUrlChanges: [],
      deployFailed: 0,
    })
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(
          prev,
          PARENT_FIELD,
          DEPENDENTS,
          'sheet-2',
          mappedRepickContext('sheet-1')
        )
      )
    })
    await act(async () => {
      await get().sync()
    })

    expect(get().reconfig[dependentKey(PARENT_FIELD)]).toBe('sheet-2')
  })

  it('keeps a newer target mapping selected while Sync was in flight', async () => {
    const pendingPromote = createDeferred<typeof SUCCESSFUL_PROMOTE_RESULT>()
    mockPromote.mockReturnValue(pendingPromote.promise)
    const { get } = renderForkSync()
    let syncPromise!: Promise<void>

    act(() => {
      syncPromise = get().sync()
    })
    await act(async () => Promise.resolve())
    expect(mockPromote).toHaveBeenCalledTimes(1)

    act(() => get().setTarget(CREDENTIAL_ENTRY, 'cred-newer'))
    pendingPromote.resolve(SUCCESSFUL_PROMOTE_RESULT)
    await act(async () => syncPromise)

    expect(get().targetFor(CREDENTIAL_ENTRY)).toBe('cred-newer')
    expect(get().dirty).toBe(true)
  })

  it('keeps a newer dependent re-pick made while Sync was in flight', async () => {
    const pendingPromote = createDeferred<typeof SUCCESSFUL_PROMOTE_RESULT>()
    mockPromote.mockReturnValue(pendingPromote.promise)
    const { get } = renderForkSync()
    let syncPromise!: Promise<void>

    act(() => {
      syncPromise = get().sync()
    })
    await act(async () => Promise.resolve())
    expect(mockPromote).toHaveBeenCalledTimes(1)

    act(() => {
      get().setReconfig((current) => ({
        ...current,
        [dependentKey(PARENT_FIELD)]: 'sheet-newer',
      }))
    })
    pendingPromote.resolve(SUCCESSFUL_PROMOTE_RESULT)
    await act(async () => syncPromise)

    expect(get().reconfig[dependentKey(PARENT_FIELD)]).toBe('sheet-newer')
    expect(get().dirty).toBe(true)
  })

  it('keeps newer mapping edits made while Save was in flight', () => {
    let finishSave: (() => void) | undefined
    mockUpdateMutate.mockImplementation((_variables, options) => {
      finishSave = options.onSuccess
    })
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((current) => ({
        ...current,
        [dependentKey(PARENT_FIELD)]: 'sheet-submitted',
      }))
    })
    act(() => get().save())

    act(() => {
      get().setTarget(CREDENTIAL_ENTRY, 'cred-newer')
      get().setReconfig((current) => ({
        ...current,
        [dependentKey(PARENT_FIELD)]: 'sheet-newer',
      }))
    })
    act(() => finishSave?.())

    expect(get().targetFor(CREDENTIAL_ENTRY)).toBe('cred-newer')
    expect(get().reconfig[dependentKey(PARENT_FIELD)]).toBe('sheet-newer')
    expect(get().dirty).toBe(true)
  })
})

describe('shouldReconfigureEntry', () => {
  const entry = (overrides: Partial<ForkMappingEntry> = {}): ForkMappingEntry =>
    ({
      kind: 'credential',
      sourceId: 'cred-src',
      targetId: 'cred-tgt',
      suggested: false,
      ...overrides,
    }) as ForkMappingEntry

  it('is false for a settled non-custom-block mapping', () => {
    // An unchanged credential mapping leaves its stored dependent picks valid, so its fields
    // stay out of the way until something actually changes.
    expect(shouldReconfigureEntry(entry(), {})).toBe(false)
  })

  it('is true for a custom block mapped to a DIFFERENT block, even once saved', () => {
    // The regression: `parentChanged` drove the reconfigure UI off "was this edited in this
    // session", so a saved mapping read as settled and the modal showed "no changes required"
    // with no inputs. A custom block pointed elsewhere has sub-blocks keyed by the SOURCE
    // block's field ids — they describe nothing on the target and nothing carries over — so it
    // needs configuring for as long as the mapping stands, not just the session it was made in.
    const saved = entry({
      kind: 'custom-block',
      sourceId: 'custom_block_prod01',
      targetId: 'custom_block_uat0001',
    })

    expect(shouldReconfigureEntry(saved, {})).toBe(true)
  })

  it('is false for a custom block mapped to itself', () => {
    // "Keep the same block across environments": the type never changes, so the source's own
    // field ids still describe it and its values carry across untouched.
    const identity = entry({
      kind: 'custom-block',
      sourceId: 'custom_block_prod01',
      targetId: 'custom_block_prod01',
    })

    expect(shouldReconfigureEntry(identity, {})).toBe(false)
  })

  it('follows an in-session custom-block re-pick rather than the saved target', () => {
    const saved = entry({
      kind: 'custom-block',
      sourceId: 'custom_block_prod01',
      targetId: 'custom_block_uat0001',
    })
    const key = `${saved.kind}:${saved.sourceId}`

    // Re-pointed back at itself in-session: nothing to configure.
    expect(shouldReconfigureEntry(saved, { [key]: 'custom_block_prod01' })).toBe(false)
    // Re-pointed at a third block: configure against that one.
    expect(shouldReconfigureEntry(saved, { [key]: 'custom_block_sbx0001' })).toBe(true)
  })

  it('is false for an unmapped custom block, which the promote blocks instead', () => {
    const unmapped = entry({
      kind: 'custom-block',
      sourceId: 'custom_block_prod01',
      targetId: null,
    })

    expect(shouldReconfigureEntry(unmapped, {})).toBe(false)
  })
})
