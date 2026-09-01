import type { CodePlaceholderRuntimeBinding } from '@/lib/execution/code-placeholders/types'

function assertNever(value: never): never {
  throw new Error(`Unsupported function runtime binding kind: ${String(value)}`)
}

/** Builds trusted preload source for compiler-owned JavaScript runtime bindings. */
export function buildJavaScriptRuntimeBindingsSource(
  runtimeBindings: readonly CodePlaceholderRuntimeBinding[]
): string {
  return runtimeBindings
    .map((binding) => {
      switch (binding.kind) {
        case 'javascript-runtime':
          return [
            '((objectConstructor) => {',
            'const templateObjects = [];',
            'const value = objectConstructor.freeze({',
            'RegExp: /^(?:)$/.constructor,',
            'freeze: objectConstructor.freeze.bind(objectConstructor),',
            'defineProperty: objectConstructor.defineProperty.bind(objectConstructor),',
            'template: (index, create) => templateObjects[index] ?? (templateObjects[index] = create())',
            '});',
            `objectConstructor.defineProperty(globalThis, ${JSON.stringify(binding.name)},`,
            '{ value, writable: false, configurable: false });',
            '})(({}).constructor);',
          ].join(' ')
        default:
          return assertNever(binding.kind)
      }
    })
    .join('\n')
}
