import type { CatalogBlockDetail } from '@/lib/catalog/projection/block-detail'
import type { CatalogBlockSummary } from '@/lib/catalog/projection/block-summary'
import { VALID_LOOP_TYPES, VALID_PARALLEL_TYPES } from '@/lib/workflows/editing/operations'

/**
 * Loop and Parallel are containers, not registry blocks — yet the authoring
 * surface accepts them as `type: "loop"` / `type: "parallel"` in add_block
 * operations, and the canvas presents them alongside blocks. A catalog that
 * omits them teaches one vocabulary and 404s on the other; these descriptors
 * make the catalog speak the authoring surface's language. Their option lists
 * import the authoring constants directly, so the surfaces cannot drift.
 */

const loopSummary: CatalogBlockSummary = {
  id: 'loop',
  name: 'Loop',
  description:
    'Container that runs its child blocks repeatedly: a fixed count (for), once per item of a collection (forEach), or while a condition holds (while/doWhile).',
  category: 'blocks',
  source: 'builtin',
  triggerAllowed: false,
  triggerCapable: false,
  preview: false,
  tags: [],
  triggerIds: [],
  toolIds: [],
  operationIds: [],
}

const parallelSummary: CatalogBlockSummary = {
  id: 'parallel',
  name: 'Parallel',
  description:
    'Container that runs its child blocks in concurrent branches: a fixed count, or one branch per item of a collection.',
  category: 'blocks',
  source: 'builtin',
  triggerAllowed: false,
  triggerCapable: false,
  preview: false,
  tags: [],
  triggerIds: [],
  toolIds: [],
  operationIds: [],
}

const CONTAINER_USAGE =
  'Containers are authored through workflows operations apply (add_block with this type, children via nestedNodes or parentId), not placed like tool blocks. Wire the body through the container handles (loop-start-source / loop-end-source, parallel-start-source / parallel-end-source); an unwired body never runs.'

const loopDetail: CatalogBlockDetail = {
  ...loopSummary,
  bestPractices: CONTAINER_USAGE,
  inputSchema: [
    {
      id: 'loopType',
      type: 'dropdown',
      title: 'Loop type',
      required: true,
      options: VALID_LOOP_TYPES.map((id) => ({ id })),
      description: 'How iteration is driven. Defaults to "for".',
    },
    {
      id: 'iterations',
      type: 'short-input',
      title: 'Iterations',
      condition: { field: 'loopType', value: 'for' },
      description: 'Number of iterations for a for loop.',
    },
    {
      id: 'collection',
      type: 'long-input',
      title: 'Collection',
      condition: { field: 'loopType', value: 'forEach' },
      description: 'Array (or reference resolving to one) iterated by a forEach loop.',
    },
    {
      id: 'condition',
      type: 'long-input',
      title: 'Condition',
      condition: { field: 'loopType', value: ['while', 'doWhile'] },
      description:
        'Continue condition for while/doWhile. May not reference blocks inside the loop body.',
    },
  ],
  operationInputSchema: {},
  inputDefinitions: {},
  operations: {},
  tools: [],
  triggers: [],
  outputs: {
    index: {
      type: 'number',
      description: 'Current iteration index inside the body (<loop.index>).',
    },
    currentItem: {
      type: 'any',
      description: 'Current item inside a forEach body (<loop.currentItem>).',
    },
    items: {
      type: 'array',
      description: 'The full collection inside a forEach body (<loop.items>).',
    },
    results: {
      type: 'array',
      description:
        'All iteration results, referenced OUTSIDE the loop by its block name (<myLoop.results>).',
    },
  },
}

const parallelDetail: CatalogBlockDetail = {
  ...parallelSummary,
  bestPractices: CONTAINER_USAGE,
  inputSchema: [
    {
      id: 'parallelType',
      type: 'dropdown',
      title: 'Parallel type',
      required: true,
      options: VALID_PARALLEL_TYPES.map((id) => ({ id })),
      description: 'How branches are created. Defaults to "count".',
    },
    {
      id: 'count',
      type: 'short-input',
      title: 'Count',
      condition: { field: 'parallelType', value: 'count' },
      description: 'Number of concurrent branches.',
    },
    {
      id: 'collection',
      type: 'long-input',
      title: 'Collection',
      condition: { field: 'parallelType', value: 'collection' },
      description: 'Array (or reference resolving to one) fanned out one branch per item.',
    },
  ],
  operationInputSchema: {},
  inputDefinitions: {},
  operations: {},
  tools: [],
  triggers: [],
  outputs: {
    index: { type: 'number', description: 'Branch index inside the body (<parallel.index>).' },
    currentItem: {
      type: 'any',
      description: 'Current item inside a collection branch (<parallel.currentItem>).',
    },
    results: {
      type: 'array',
      description:
        'All branch results, referenced OUTSIDE by the block name (<myParallel.results>).',
    },
  },
}

export const CONTAINER_BLOCK_SUMMARIES: CatalogBlockSummary[] = [loopSummary, parallelSummary]

const CONTAINER_BLOCK_DETAILS: Record<string, CatalogBlockDetail> = {
  loop: loopDetail,
  parallel: parallelDetail,
}

export function getContainerBlockDetail(blockId: string): CatalogBlockDetail | null {
  return CONTAINER_BLOCK_DETAILS[blockId] ?? null
}
