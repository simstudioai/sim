import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

/** The Platform design contract, where every `check:platform-design` rule is documented. */
export const PLATFORM_CONTRACT = 'apps/sim/platform/AGENTS.md'

/** Guidance that may name a rule id in backticks, in the order a reader should look. */
const RULE_DOCUMENTS = [
  PLATFORM_CONTRACT,
  '.claude/rules/sim-platform-views.md',
  'packages/emcn/AGENTS.md',
  'packages/emcn/README.md',
]

/** The contract section that states each rule no document names in backticks. */
const RULE_SECTIONS: Readonly<Record<string, string>> = {
  'code-use': 'Code-first product design',
  'variant-declaration': 'Code-first product design',
  'variant-selector': 'Code-first product design',
  'variant-use': 'Code-first product design',
  'paper-base': 'Code-first product design',
  'time-format': 'Code-first product design',
  'dialog-name': 'Code-first product design',
  'dialog-owner': 'Code-first product design',
  'motion-timing': 'Code-first product design',
  'feedback-timing': 'Code-first product design',
  'native-picker': 'Code-first product design',
  'product-copy': 'Code-first product design',
  'consumer-style': 'Public API',
  'style-api': 'Public API',
  'raw-color': 'Public API',
  'raw-geometry': 'Public API',
  'untokenized-style': 'Public API',
  'unknown-token': 'Public API',
  'utility-token': 'Public API',
  'css-owner': 'Public API',
  'focus-style': 'Public API',
  'specimen-owner': 'Public API',
  'family-import': 'Ownership',
  'primitive-owner': 'Ownership',
  'recipe-owner': 'Ownership',
  'private-recipe': 'Ownership',
  'private-composition': 'Ownership',
  'feature-owner': 'Ownership',
  'component-folder': 'Ownership',
  'icon-owner': 'Ownership',
  'design-dependency': 'Ownership',
  'shared-import': 'Data seam',
  'fixture-boundary': 'Data seam',
  'legacy-import': 'Data seam',
}

/** A heading's GitHub anchor. */
export function headingAnchor(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

/**
 * Where `rule` is documented, as `file#anchor`: the first section of the guidance under `root` that
 * names it in backticks, else its contract section in {@link RULE_SECTIONS}, else the contract.
 */
export function ruleDocumentation(root: string, rule: string): string {
  for (const document of RULE_DOCUMENTS) {
    const full = path.join(root, document)
    if (!existsSync(full)) continue
    let heading = ''
    for (const line of readFileSync(full, 'utf8').split('\n')) {
      if (/^#{1,6}\s/.test(line)) heading = line.replace(/^#+\s*/, '')
      if (line.includes(`\`${rule}\``))
        return heading ? `${document}#${headingAnchor(heading)}` : document
    }
  }
  const section = RULE_SECTIONS[rule]
  return section ? `${PLATFORM_CONTRACT}#${headingAnchor(section)}` : PLATFORM_CONTRACT
}
