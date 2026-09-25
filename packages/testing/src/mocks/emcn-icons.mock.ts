type MockIcon = ((props?: unknown) => null) & { displayName?: string }

const iconStubs = new Map<string, MockIcon>()

/**
 * Returns the stable stub for the icon export `name`: a component that renders nothing
 * (`() => null`, what every local factory used) with `displayName` set to `name`. The same
 * function is returned for the same name, so identity comparisons still hold.
 */
export function getEmcnIconStub(name: string): MockIcon {
  let stub = iconStubs.get(name)
  if (!stub) {
    stub = () => null
    stub.displayName = name
    iconStubs.set(name, stub)
  }
  return stub
}

/**
 * Mock module for `@sim/emcn/icons`: a Proxy that resolves every export name to
 * {@link getEmcnIconStub}, so it covers all ~200 icons without listing them. Stubs render `null`
 * rather than an `<svg>` because `@sim/testing` has no React dependency; a test asserting on icon
 * markup keeps its own factory. There are no `vi.fn()` knobs.
 *
 * @example
 * ```ts
 * vi.mock('@sim/emcn/icons', () => emcnIconsMock)
 * ```
 */
export const emcnIconsMock: Record<string, MockIcon> = new Proxy(
  {},
  {
    get: (_target, name) =>
      typeof name === 'string' && name !== 'then' ? getEmcnIconStub(name) : undefined,
    has: (_target, name) => typeof name === 'string' && name !== 'then',
  }
)
