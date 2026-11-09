/**
 * Flowcharts drawn like workflow canvas blocks and edges: rounded cards with a 1.5px outline,
 * 1.5px edges without arrowheads, and subgraphs as rounded subflow containers. Labels are pinned
 * to the font Mermaid measured them with; otherwise they inherit the surrounding document's font
 * and line height and overflow their boxes. Edge rules are scoped to flowchart classes so sequence
 * and other diagrams keep their arrows.
 */
export function mermaidWorkflowCss(fontFamily: string): string {
  return `
  .label, .nodeLabel, .edgeLabel, .label p, .nodeLabel p, .edgeLabel p {
    font-family: ${fontFamily}; font-size: 14px; line-height: 1.5; letter-spacing: normal;
  }
  .edgeLabel, .edgeLabel p { font-size: 12px; }
  .node rect, .node polygon, .node circle, .node path { stroke-width: 1.5px; }
  .node rect { rx: 10px; ry: 10px; }
  .cluster rect { rx: 14px; ry: 14px; stroke-width: 1.5px; }
  .flowchart-link { stroke-width: 1.5px; marker-end: none !important; }
`
}
