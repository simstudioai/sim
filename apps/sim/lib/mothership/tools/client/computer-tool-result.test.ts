import type { ComputerUseResult, ComputerUseSnapshot } from '@sim/desktop-bridge/computer-use'
import { describe, expect, it } from 'vitest'
import { computerToolResultForModel } from '@/lib/mothership/tools/client/computer-tool-result'

function snapshot(): ComputerUseSnapshot {
  return {
    kind: 'state',
    bundleId: 'com.example.Fixture',
    snapshotId: 'new-state',
    windowId: '1',
    windows: [{ windowId: '1', title: 'Fixture', x: 20, y: 40, width: 400, height: 300 }],
    nodes: [
      {
        elementId: 'editor',
        role: 'AXTextArea',
        actions: [],
        label: 'Composer',
        focused: true,
        editable: true,
      },
    ],
    truncated: false,
    screenshot: { base64: 'YWJj', mimeType: 'image/png', width: 800, height: 600 },
  }
}

function sequence(observation: ComputerUseSnapshot): ComputerUseResult {
  return {
    kind: 'action',
    action: 'input_sequence',
    bundleId: observation.bundleId,
    dispatched: true,
    verified: false,
    sequence: { completedSteps: 1, totalSteps: 2, error: 'Focus changed' },
    observation,
  }
}

describe('native computer model projection', () => {
  it('lifts action observation pixels without duplicating bytes or losing partial dispatch', () => {
    const result = computerToolResultForModel(sequence(snapshot()))
    expect(result).toMatchObject({
      dispatched: true,
      verified: false,
      sequence: { completedSteps: 1, error: 'Focus changed' },
      observation: {
        snapshotId: 'new-state',
        accessibilityTree: expect.stringContaining('editor AXTextArea'),
      },
      observations: [{ name: 'Computer screenshot', mediaType: 'image/png', data: 'YWJj' }],
    })
    expect(JSON.stringify(result).match(/YWJj/g)).toHaveLength(1)
    expect(result).not.toHaveProperty('observation.screenshot')
    expect(result).not.toHaveProperty('observation.observations')
  })

  it.each([false, true])(
    'keeps a late rich editor and its ancestry inline under the spill limit (nested=%s)',
    (nested) => {
      const state = snapshot()
      state.nodes = Array.from({ length: 784 }, (_, index) => ({
        elementId: `e${index}`,
        role: index === 0 ? 'AXWindow' : 'AXStaticText',
        parentId: index === 0 ? undefined : 'e0',
        label: `Control ${index} 漢字😀 "quoted" \n${'verbose '.repeat(50)}`,
        actions: index === 0 ? [] : ['AXPress', 'AXShowMenu', 'AXScrollToVisible'],
        windowId: '1',
        x: index,
        y: 42,
        width: 100,
        height: 30,
      }))
      state.nodes[781] = {
        elementId: 'send-late',
        parentId: 'e782',
        role: 'AXButton',
        label: 'Send now',
        actions: ['AXPress'],
        windowId: '1',
        x: 100,
        y: 100,
        width: 80,
        height: 32,
      }
      state.nodes[783] = {
        elementId: 'editor-late',
        parentId: 'e782',
        role: 'AXTextArea',
        label: 'Fixture composer',
        value: 'Unicode ✓',
        focused: true,
        editable: true,
        placeholder: 'Message to fixture',
        actions: ['AXConfirm'],
        windowId: '1',
      }
      const result = computerToolResultForModel(nested ? sequence(state) : state)
      const textResult = { ...result, observations: undefined }
      const serialized = JSON.stringify(textResult)
      expect(new TextEncoder().encode(serialized).length).toBeLessThan(44 * 1024)
      expect(serialized).toContain('editor-late AXTextArea parent=e782')
      expect(serialized).toContain('e782 AXStaticText parent=e0')
      expect(serialized).toContain('send-late AXButton parent=e782')
      expect(serialized).toContain('e0 AXWindow')
      expect(serialized).toContain('focused editable')
      expect(serialized).toContain('Message to fixture')
      const projected = 'observation' in result ? result.observation : result
      expect(projected).toMatchObject({ truncated: true, omittedNodeCount: expect.any(Number) })
      expect(
        projected && 'omittedNodeCount' in projected && projected.omittedNodeCount
      ).toBeGreaterThan(0)
      expect(state.nodes).toHaveLength(784)
      expect(state.nodes[783]?.label).toBe('Fixture composer')
    }
  )

  it('does not split an emoji when bounding text for the model', () => {
    const state = snapshot()
    state.nodes[0] = {
      elementId: 'editor',
      role: 'AXTextArea',
      actions: [],
      value: `${'x'.repeat(511)}😀suffix`,
      editable: true,
    }
    const output = computerToolResultForModel(state)
    expect(JSON.stringify(output)).not.toContain('\\ud83d')
    expect(output).toMatchObject({ truncated: true })
  })

  it('preserves the dispatched action when observation failed', () => {
    const result = {
      kind: 'action',
      action: 'click',
      bundleId: 'com.example.Fixture',
      dispatched: true,
      verified: false,
      observationError: 'Window closed',
    } satisfies ComputerUseResult
    expect(computerToolResultForModel(result)).toEqual(result)
  })
})
