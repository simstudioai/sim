import { conformanceScope } from '#design-conformance/artwork'

/** Product browser routes remain in scope even when a directory is named desktop. */
export function productScope(file: string): 'check' | 'exclude' | 'unsupported' {
  if (
    file.startsWith('apps/sim/app/(landing)/') ||
    file.startsWith('apps/sim/app/(docs)/') ||
    file.startsWith('apps/sim/app/design-studio/') ||
    file.startsWith('apps/sim/tools/generated/') ||
    ['apps/sim/lib/content/mdx.tsx', 'apps/sim/lib/content/faq.tsx'].includes(file)
  )
    return 'exclude'
  if (
    (file.startsWith('apps/sim/app/desktop/') ||
      /^apps\/sim\/app\/workspace\/[^/]+\/settings\/components\/desktop\//.test(file)) &&
    !/\.(?:test|spec|generated|d)\.[cm]?[jt]sx?$/.test(file)
  )
    return /\.(?:[cm]?[jt]sx?|css|html?)$/.test(file) ? 'check' : 'unsupported'
  return conformanceScope(file)
}
