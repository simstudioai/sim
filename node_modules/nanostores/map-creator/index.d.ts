import type { MapStore } from '../map/index.js'

export interface MapCreator<
  Value extends object = any,
  Args extends any[] = []
> {
  (id: string, ...args: Args): MapStore<Value>
  build(id: string, ...args: Args): MapStore<Value>
  cache: {
    [id: string]: MapStore<{ id: string } & Value>
  }
}

/**
 * Create function to create map stores. It will be like a class for store.
 *
 * @param init Store’s initializer. Returns store destructor.
 */
export function mapCreator<
  Value extends object,
  Args extends any[] = [],
  StoreExt = Record<unknown, any>
>(
  init?: (
    store: MapStore<{ id: string } & Value> & StoreExt,
    id: string,
    ...args: Args
  ) => (() => void) | void
): MapCreator<Value, Args>
