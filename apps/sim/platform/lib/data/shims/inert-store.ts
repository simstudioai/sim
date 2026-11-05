/**
 * The `getState` half of a store this app has no canvas to hydrate, exposing only the fields the chat
 * hook is known to read. Those read as idle. Subscribing as a hook or reaching for anything else
 * throws, so a new read fails where it happens rather than quietly receiving nothing.
 */
export function inertStore<State extends object>(source: string, state: State) {
  const refuse = (read: string) =>
    new Error(`${source} has no canvas in the Platform, yet ${read} was read from it`)
  const guarded = new Proxy(state, {
    get(target, key, receiver) {
      if (typeof key === 'symbol' || key in target) return Reflect.get(target, key, receiver)
      throw refuse(`"${key}"`)
    },
  })
  const subscribe = (): never => {
    throw refuse('a subscription')
  }
  return Object.assign(subscribe, { getState: () => guarded })
}
