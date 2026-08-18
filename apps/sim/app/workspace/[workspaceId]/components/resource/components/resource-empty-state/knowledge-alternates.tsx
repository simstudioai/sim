import { Bar } from '@/app/workspace/[workspaceId]/components/resource/components/resource-empty-state/vignette'

/**
 * Review-only: three candidate depictions of a knowledge base, rendered side by
 * side so the family can be judged before one is adopted. Delete once chosen.
 */
const INK = {
  strong: 'color-mix(in srgb, var(--text-secondary) 30%, transparent)',
  line: 'color-mix(in srgb, var(--text-secondary) 15%, transparent)',
  match: 'color-mix(in srgb, var(--text-secondary) 34%, transparent)',
} as const

const CORNER_FADE =
  '[-webkit-mask-image:linear-gradient(to_right,#000_66%,transparent_100%),linear-gradient(to_bottom,#000_70%,transparent_100%)] [mask-image:linear-gradient(to_right,#000_66%,transparent_100%),linear-gradient(to_bottom,#000_70%,transparent_100%)] [-webkit-mask-composite:source-in] [mask-composite:intersect]'

/** A — the embedding mesh, lifted from the landing hero's own knowledge-base panel. */
const GRAPH_NODES = [
  { x: 38, y: 66 },
  { x: 74, y: 104 },
  { x: 96, y: 44 },
  { x: 132, y: 82, hub: true },
  { x: 158, y: 40 },
  { x: 168, y: 116 },
  { x: 206, y: 70, hub: true },
  { x: 228, y: 38 },
  { x: 236, y: 112 },
  { x: 268, y: 72 },
  { x: 300, y: 104, hub: true },
  { x: 312, y: 58 },
  { x: 286, y: 40 },
  { x: 54, y: 96 },
  { x: 140, y: 122 },
  { x: 250, y: 96 },
]

const GRAPH_EDGES: Array<[number, number]> = [
  [0, 2],
  [0, 13],
  [13, 1],
  [1, 3],
  [2, 3],
  [2, 4],
  [3, 4],
  [3, 5],
  [3, 14],
  [5, 14],
  [4, 6],
  [6, 7],
  [6, 15],
  [6, 8],
  [7, 12],
  [12, 9],
  [9, 15],
  [8, 15],
  [9, 10],
  [8, 10],
  [10, 11],
  [11, 12],
  [9, 11],
]

export function KnowledgeGraphMesh() {
  return (
    <div aria-hidden='true' className={`relative h-[148px] w-[320px] ${CORNER_FADE}`}>
      <svg className='absolute inset-0' viewBox='0 0 340 150' width='320' height='148' fill='none'>
        {GRAPH_EDGES.map(([a, b]) => (
          <path
            key={`${a}-${b}`}
            d={`M ${GRAPH_NODES[a].x} ${GRAPH_NODES[a].y} L ${GRAPH_NODES[b].x} ${GRAPH_NODES[b].y}`}
            stroke='var(--text-subtle)'
            strokeWidth={0.5}
          />
        ))}
        {GRAPH_NODES.map((node, index) => (
          <circle
            key={`${node.x}-${node.y}`}
            cx={node.x}
            cy={node.y}
            r={node.hub ? 3.4 : index % 3 === 0 ? 2.4 : 1.9}
            fill={
              node.hub
                ? 'var(--text-secondary)'
                : index % 2 === 0
                  ? 'var(--text-muted)'
                  : 'var(--text-subtle)'
            }
          />
        ))}
      </svg>
    </div>
  )
}

/** B — a stack of documents, the literal contents of a base. */
export function KnowledgeDocumentStack() {
  return (
    <div aria-hidden='true' className={`relative h-[148px] w-[320px] ${CORNER_FADE}`}>
      {[
        { left: 60, top: 18 },
        { left: 84, top: 36 },
        { left: 108, top: 54 },
      ].map((offset, index) => (
        <div
          key={offset.left}
          className='absolute h-[80px] w-[112px] rounded-[6px] border border-[var(--border-1)] bg-[var(--bg)] px-3 pt-3'
          style={{ left: offset.left, top: offset.top, zIndex: 3 - index }}
        >
          {[62, 76, 54, 68].map((width, line) => (
            <span
              key={width}
              className='mb-[9px] block h-[5px] rounded-full'
              style={{ width, background: line === 0 ? INK.strong : INK.line }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

/** C — a query, and the passages inside a document that answered it. */
export function KnowledgeRetrieval() {
  return (
    <div aria-hidden='true' className={`relative h-[148px] w-[320px] ${CORNER_FADE}`}>
      <div className='absolute top-[16px] left-[46px] flex h-[26px] w-[168px] items-center gap-2 rounded-full border border-[var(--border-1)] px-3'>
        <span className='size-[9px] shrink-0 rounded-full border border-[var(--text-subtle)]' />
        <Bar className='h-[5px] w-[86px]' style={{ background: INK.strong }} />
      </div>

      <div className='absolute top-[56px] left-[46px] w-[200px] rounded-[6px] border border-[var(--border-1)] px-3 py-3'>
        {[
          { width: 152, match: false },
          { width: 128, match: true },
          { width: 164, match: false },
          { width: 110, match: true },
          { width: 140, match: false },
        ].map((line, index) => (
          <span
            key={`${line.width}-${index}`}
            className='mb-[9px] block h-[6px] rounded-full'
            style={{ width: line.width, background: line.match ? INK.match : INK.line }}
          />
        ))}
      </div>
    </div>
  )
}
