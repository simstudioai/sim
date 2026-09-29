import type { StudioEntry, StudioTreatment } from './manifest'

const ELEMENT_ROLE_NAMES: Record<string, string> = {
  a: 'Link',
  button: 'Button',
  div: 'Surface',
  h1: 'Heading',
  h2: 'Heading',
  img: 'Image',
  input: 'Input',
  span: 'Text',
  textarea: 'Text area',
}

const FAMILY_NAMES: Record<string, string> = {
  'central-artwork': 'Product artwork',
  'central-colour': 'Colours',
  'central-colour-assignment': 'Runtime colours',
  'central-radius': 'Corner radii',
  'central-typography': 'EMCN typography',
  'component-chrome': 'Component styling',
  'emcn-recipe-override': 'EMCN styling overrides',
  'local-alpha': 'Local opacity',
  'local-control': 'Local controls',
  'local-typography': 'Local typography',
  'local-visual-primitive': 'Visual primitives',
  'mixed-product-artwork': 'Mixed artwork',
  'repeated-treatment': 'Repeated treatments',
  'runtime-style': 'Runtime styling',
  'runtime-style-customer-brand': 'Customer branding',
  'runtime-style-editor-tooltip': 'Editor tooltips',
  'shared-product-recipe': 'Shared product recipes',
  'stock-shadow': 'Stock shadows',
  'styled-native-control': 'Styled native controls',
}

export function formatFamily(family: string): string {
  if (FAMILY_NAMES[family]) return FAMILY_NAMES[family]
  return family.replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function formatExportName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
}

function formatExtraName(name: string): string {
  const [owner, target] = name.split(' / ')
  const ownerName = formatExportName(owner.replaceAll('_', ' '))
  if (target?.startsWith('@sim/emcn#')) {
    return `${ownerName} · ${formatExportName(target.slice('@sim/emcn#'.length))}`
  }
  if (target) {
    const element = target.split(' / ')[0]
    if (owner === 'css') return `CSS · ${element.slice(0, 40)}`
    return `${ownerName} · ${ELEMENT_ROLE_NAMES[element] ?? formatExportName(element)}`
  }
  return formatExportName(name.replaceAll('_', ' '))
}

export function sourceFileName(file: string): string {
  return file.split('/').at(-1) ?? file
}

export function extraShortValue(entry: StudioEntry): string {
  if (entry.family.includes('artwork')) return 'Product artwork'
  const value = entry.value ?? entry.fixture?.sample?.values[0]
  if (!value) return sourceFileName(entry.source.file)
  if (/^[a-f0-9]{32,}$/i.test(value)) return 'Source fingerprint'
  return value.length > 52 ? `${value.slice(0, 49)}…` : value
}

function extraKey(entry: StudioEntry): string {
  const fixture = entry.fixture
  if (fixture?.type === 'sample' && fixture.sample) {
    const sample = fixture.sample
    if (sample.className || sample.values.length) {
      return JSON.stringify(['sample', sample.kind, sample.tag, sample.className, sample.values])
    }
    return JSON.stringify([
      'source-location',
      entry.source.file,
      entry.source.line,
      sample.kind,
      sample.property,
      sample.value,
    ])
  }
  if (entry.id.startsWith('shadow-extra:') || entry.id.startsWith('typography-extra:')) {
    return entry.id
  }
  if (fixture?.type === 'extra') return `source-component:${fixture.id}`
  return entry.id
}

/** Group every scanner signal into the same visual treatment shown by Studio. */
export function groupExtras(entries: StudioEntry[]): StudioTreatment[] {
  const groups = new Map<string, StudioEntry[]>()
  for (const entry of entries) {
    const key = extraKey(entry)
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  return [...groups].map(([key, members]) => {
    const names = new Set(members.map((member) => member.name))
    const locations = new Set(
      members.map((member) => `${member.source.file}:${member.source.line}`)
    )
    const sample = members[0].fixture?.sample
    const title =
      names.size > 1 && locations.size > 1 && sample?.className
        ? `${formatExportName(sample.tag)} · ${extraShortValue(members[0])}`
        : formatExtraName(members[0].name)
    return { key, family: members[0].family, title, entries: members }
  })
}

/** One section per live preview; each export owns its variants and use sites. */
export function groupComponents(entries: StudioEntry[]): StudioTreatment[] {
  const groups = new Map<string, StudioEntry[]>()
  for (const entry of entries) {
    const key = entry.fixture
      ? `${entry.family}:${entry.fixture.type}:${entry.fixture.id}`
      : entry.id
    const group = groups.get(key) ?? []
    group.push(entry)
    groups.set(key, group)
  }
  return [...groups].map(([key, members]) => ({
    key,
    family: members[0].family,
    title:
      members.length > 1 && members[0].family !== 'Icons'
        ? formatFamily(members[0].family)
        : members.length > 1
          ? members.map((member) => formatExportName(member.name)).join(' / ')
          : formatExportName(members[0].name),
    entries: members,
  }))
}
