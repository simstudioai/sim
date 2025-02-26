import { SerializedWorkflow } from '../../../serializer/types'

export const createMinimalWorkflow = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Test Block' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'block1',
    },
  ],
  loops: {},
})

export const createWorkflowWithLoop = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'block1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Loop Block 1' },
    },
    {
      id: 'block2',
      position: { x: 200, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'Loop Block 2' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'block1',
    },
    {
      source: 'block1',
      target: 'block2',
    },
    {
      source: 'block2',
      target: 'block1',
    },
  ],
  loops: {
    loop1: {
      id: 'loop1',
      nodes: ['block1', 'block2'],
      maxIterations: 5,
    },
  },
})

export const createWorkflowWithCondition = (): SerializedWorkflow => ({
  version: '1.0',
  blocks: [
    {
      id: 'starter',
      position: { x: 0, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'starter', name: 'Starter Block' },
    },
    {
      id: 'condition1',
      position: { x: 100, y: 0 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'condition', name: 'Condition Block' },
    },
    {
      id: 'block1',
      position: { x: 200, y: -50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'True Path Block' },
    },
    {
      id: 'block2',
      position: { x: 200, y: 50 },
      config: { tool: 'test-tool', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
      metadata: { id: 'test', name: 'False Path Block' },
    },
  ],
  connections: [
    {
      source: 'starter',
      target: 'condition1',
    },
    {
      source: 'condition1',
      target: 'block1',
      sourceHandle: 'condition-true',
    },
    {
      source: 'condition1',
      target: 'block2',
      sourceHandle: 'condition-false',
    },
  ],
  loops: {},
})
