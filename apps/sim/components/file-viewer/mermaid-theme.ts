/**
 * Mermaid `base` theme variables drawn from the app's tokens, so diagrams match the editor and
 * charts instead of Mermaid's stock palette. Mermaid derives shades from these with its own colour
 * library, so every token read here must resolve to a plain hex or rgb value.
 */
export function readMermaidThemeVariables(
  element: Element,
  darkMode: boolean
): Record<string, string | boolean> {
  const styles = getComputedStyle(element)
  const token = (name: string) => {
    const value = styles.getPropertyValue(name).trim()
    if (!value) throw new Error(`Missing diagram theme token ${name}`)
    return value
  }
  const background = token('--bg')
  const node = token('--surface-2')
  const muted = token('--surface-4')
  const subtle = token('--surface-5')
  const border = token('--border')
  const text = token('--text-primary')
  const body = token('--text-body')
  const line = token('--text-icon')
  return {
    darkMode,
    fontFamily: getComputedStyle(document.body).fontFamily,
    fontSize: '14px',
    background,
    primaryColor: node,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: muted,
    secondaryTextColor: body,
    secondaryBorderColor: border,
    tertiaryColor: subtle,
    tertiaryTextColor: body,
    tertiaryBorderColor: border,
    mainBkg: node,
    nodeBorder: border,
    textColor: body,
    lineColor: token('--workflow-edge'),
    clusterBkg: token('--surface-3'),
    clusterBorder: border,
    edgeLabelBackground: background,
    noteBkgColor: muted,
    noteTextColor: body,
    noteBorderColor: border,
    actorBkg: node,
    actorBorder: border,
    actorTextColor: text,
    actorLineColor: line,
    signalColor: line,
    signalTextColor: body,
    labelBoxBkgColor: subtle,
    labelBoxBorderColor: border,
    labelTextColor: body,
    loopTextColor: body,
    sequenceNumberColor: background,
    pie1: body,
    pie2: line,
    pie3: token('--text-subtle'),
    pie4: token('--text-muted'),
    pieStrokeColor: background,
    pieTitleTextColor: text,
    pieSectionTextColor: background,
    pieLegendTextColor: body,
  }
}

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
