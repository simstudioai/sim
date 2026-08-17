/**
 * @vitest-environment jsdom
 *
 * Coverage for the payload {@link useForkSync} actually submits, not just the helpers it calls.
 * `dependent-value.test.ts` proves `submittedDependentValue` omits a field an in-block parent
 * re-pick invalidated; nothing there proves the hook USES it. Reverting the hook back to
 * `dependentValueFor` re-introduces the P0 - a `{ value: '' }` written over the target's stored
 * configuration - while every unit test stays green, so these tests assert on the submitted
 * bodies and on the derived `dirty` / `syncDisabled` gates instead.
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
  DEPENDENT_CLEARED_BY_PARENT,
  dependentKey,
} from '@/ee/workspace-forking/components/fork-sync/dependent-value'
import {
  type ForkSyncController,
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
  mockPromote.mockResolvedValue({
    promoteRunId: 'run-1',
    blockers: [],
    unmappedRequired: [],
    droppedReferences: [],
    triggerUrlChanges: [],
    deployFailed: 0,
  })
})

afterEach(() => {
  act(() => {
    for (const root of mountedRoots.splice(0)) root.unmount()
  })
})

describe('useForkSync dependent payload', () => {
  it('omits a dependent an in-block parent re-pick invalidated, so the target keeps its stored value', () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(prev, PARENT_FIELD, DEPENDENTS, 'sheet-2', 'sheet-1')
      )
    })

    expect(get().reconfig[dependentKey(CHILD_FIELD)]).toBe(DEPENDENT_CLEARED_BY_PARENT)

    act(() => get().save())

    const submitted = savedDependentValues()
    expect(submitted?.map((entry) => entry.subBlockKey)).toEqual([
      PARENT_FIELD.subBlockKey,
      CLEARED_FIELD.subBlockKey,
      UNTOUCHED_FIELD.subBlockKey,
    ])
    expect(valueFor(submitted, PARENT_FIELD)).toBe('sheet-2')
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

  it('leaves the editor clean when only markers remain, so an undone re-pick is not savable', () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(prev, PARENT_FIELD, DEPENDENTS, 'sheet-2', 'sheet-1')
      )
    })
    expect(get().dirty).toBe(true)

    // The user puts the provider back to its stored value. Their own re-pick is no longer a
    // change, and the marker it left on the child contributes nothing to the payload - so
    // nothing is savable, even though `reconfig` is not empty.
    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(prev, PARENT_FIELD, DEPENDENTS, 'sheet-1', 'sheet-2')
      )
    })

    expect(get().reconfig[dependentKey(CHILD_FIELD)]).toBe(DEPENDENT_CLEARED_BY_PARENT)
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
          'sheet-1'
        )
      )
    })

    expect(get().syncDisabled).toBe(true)
    expect(get().syncDisabledReason).toBe('Reconfigure all required fields first')
  })

  it('omits the marked dependent from the promote payload too', async () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(prev, PARENT_FIELD, DEPENDENTS, 'sheet-2', 'sheet-1')
      )
    })
    await act(async () => {
      await get().sync()
    })

    expect(promotedDependentValues()?.map((entry) => entry.subBlockKey)).not.toContain(
      CHILD_FIELD.subBlockKey
    )
  })
})

describe('useForkSync post-sync reset', () => {
  it('drops the in-session re-picks once the sync commits them', async () => {
    const { get } = renderForkSync()

    act(() => {
      get().setReconfig((prev) =>
        applyDependentRepick(prev, PARENT_FIELD, DEPENDENTS, 'sheet-2', 'sheet-1')
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
        applyDependentRepick(prev, PARENT_FIELD, DEPENDENTS, 'sheet-2', 'sheet-1')
      )
    })
    await act(async () => {
      await get().sync()
    })

    expect(get().reconfig[dependentKey(PARENT_FIELD)]).toBe('sheet-2')
  })
})
