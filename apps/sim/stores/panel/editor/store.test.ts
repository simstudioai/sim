/**
 * The Variables tab covers the editor in the right panel. Failure mode: "Open Editor" or "Rename"
 * on the block that is already the editor's leaves Variables showing, since nothing it watches
 * changed.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useVariablesModalStore } from '@/stores/modals/variables/store'
import { usePanelEditorStore } from '@/stores/panel/editor/store'
import { usePanelStore } from '@/stores/panel/store'

describe('usePanelEditorStore.setCurrentBlockId', () => {
  beforeEach(() => {
    usePanelEditorStore.setState({ currentBlockId: 'block-1' })
    usePanelStore.getState().setActiveTab('editor')
    useVariablesModalStore.getState().setIsOpen(true)
  })

  it('takes the panel off Variables when it targets the block already open', () => {
    usePanelEditorStore.getState().setCurrentBlockId('block-1')

    expect(useVariablesModalStore.getState().isOpen).toBe(false)
    expect(usePanelStore.getState().activeTab).toBe('editor')
  })

  it('leaves Variables open when the selection clears', () => {
    usePanelEditorStore.getState().setCurrentBlockId(null)

    expect(useVariablesModalStore.getState().isOpen).toBe(true)
  })
})
