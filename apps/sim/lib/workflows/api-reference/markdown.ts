import type {
  ApiReferenceDoc,
  ApiReferenceEntry,
  JsonSchemaNode,
} from '@/lib/workflows/api-reference/types'

/** Renders a JSON Schema node as a compact indented field list for human reading. */
function renderSchema(node: JsonSchemaNode, indent = 0): string {
  const pad = '  '.repeat(indent)
  if (node.type !== 'object' || !node.properties) {
    const desc = node.description ? ` — ${node.description}` : ''
    return `${pad}(${node.type})${desc}`
  }
  const required = new Set(node.required ?? [])
  const lines: string[] = []
  for (const [key, prop] of Object.entries(node.properties)) {
    const req = required.has(key) ? ' *(required)*' : ''
    const desc = prop.description ? ` — ${prop.description}` : ''
    lines.push(`${pad}- \`${key}\` (${prop.type})${req}${desc}`)
    if (prop.type === 'object' && prop.properties) {
      lines.push(renderSchema(prop, indent + 1))
    }
  }
  return lines.join('\n')
}

/** Renders a single entry as a markdown section. */
export function renderEntryMarkdown(entry: ApiReferenceEntry): string {
  const lines: string[] = []
  lines.push(`## ${entry.name}`)
  if (entry.summary) lines.push(`\n${entry.summary}`)
  lines.push('')
  lines.push(`- **Workflow ID:** \`${entry.workflowId}\``)
  lines.push(`- **Version:** ${entry.version ?? 'not deployed'}`)
  if (entry.deployedAt) lines.push(`- **Deployed:** ${entry.deployedAt}`)
  lines.push(`- **Invoke:** \`POST ${entry.invokeUrl}\``)
  lines.push(`- **Auth:** ${entry.auth.description}`)
  if (entry.description) {
    lines.push('')
    lines.push(entry.description)
  }
  lines.push('')
  lines.push('### Input')
  lines.push(renderSchema(entry.input))
  lines.push('')
  lines.push('### Output')
  lines.push(renderSchema(entry.output))

  if (entry.versions.length > 0) {
    lines.push('')
    lines.push('### Version history')
    for (const v of entry.versions) {
      const flag = v.breaking ? ' **(breaking)**' : ''
      lines.push(`- **v${v.version}**${flag}: ${v.changes.join('; ')}`)
    }
  }
  return lines.join('\n')
}

/** Renders the whole workspace doc as a single markdown document. */
export function renderDocMarkdown(doc: ApiReferenceDoc): string {
  const header = [
    `# ${doc.name} — API Reference`,
    '',
    `_Generated ${doc.generatedAt}. Workspace \`${doc.workspaceId}\`._`,
    '',
    doc.entries.length === 0 ? '_No published workflows._' : '',
  ]
  return [...header, ...doc.entries.map(renderEntryMarkdown)].join('\n\n')
}
