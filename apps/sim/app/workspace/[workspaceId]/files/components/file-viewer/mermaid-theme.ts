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
    lineColor: line,
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
    pie2: token('--text-subtle'),
    pie3: token('--surface-7'),
    pie4: line,
    pieStrokeColor: background,
    pieTitleTextColor: text,
    pieSectionTextColor: background,
    pieLegendTextColor: body,
  }
}
