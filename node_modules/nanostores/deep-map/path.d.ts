type ConcatPath<T extends string, P extends string> = T extends ''
  ? P
  : `${T}.${P}`

type Length<T extends any[]> = T extends { length: infer L } ? L : never

type BuildTuple<L extends number, T extends any[] = []> = T extends {
  length: L
}
  ? T
  : BuildTuple<L, [...T, any]>

type Subtract<A extends number, B extends number> = BuildTuple<A> extends [
  ...infer U,
  ...BuildTuple<B>
]
  ? Length<U>
  : never

export type AllPaths<
  T,
  P extends string = '',
  MaxDepth extends number = 10
> = T extends (infer U)[]
  ?
      | `${P}[${number}]`
      | AllPaths<U, `${P}[${number}]`, Subtract<MaxDepth, 1>>
      | P
  : T extends BaseDeepMap
  ? MaxDepth extends 0
    ? never
    : {
        [K in keyof T]-?: K extends number | string
          ?
              | AllPaths<T[K], ConcatPath<P, `${K}`>, Subtract<MaxDepth, 1>>
              | (P extends '' ? never : P)
          : never
      }[keyof T]
  : P

type IsNumber<T extends string> = T extends `${number}` ? true : false

type ElementType<T> = T extends (infer U)[] ? U : never

type Unwrap<T, P> = P extends `[${infer I}]${infer R}`
  ? [ElementType<T>, IsNumber<I>] extends [infer Item, true]
    ? R extends ''
      ? Item
      : Unwrap<Item, R>
    : never
  : never

type NestedObjKey<T, P> = P extends `${infer A}.${infer B}`
  ? A extends keyof T
    ? FromPath<NonNullable<T[A]>, B>
    : never
  : never

type NestedArrKey<T, P> = P extends `${infer A}[${infer I}]${infer R}`
  ? [A, NonNullable<T[Extract<A, keyof T>]>, IsNumber<I>] extends [
      keyof T,
      (infer Item)[],
      true
    ]
    ? R extends ''
      ? Item
      : R extends `.${infer NewR}`
        ? FromPath<Item, NewR>
        : R extends `${infer Indices}.${infer MoreR}`
          ? FromPath<Unwrap<Item, Indices>, MoreR>
          : Unwrap<Item, R>
    : never
  : never

export type FromPath<T, P> = T extends unknown
  ? NestedArrKey<T, P> extends never
    ? NestedObjKey<T, P> extends never
      ? P extends keyof T
        ? T[P]
        : never
      : NestedObjKey<T, P>
    : NestedArrKey<T, P>
  : never

export type BaseDeepMap = Record<string, unknown>

/**
 * Get a value by object path. `undefined` if key is missing.
 *
 * ```
 * import { getPath } from 'nanostores'
 *
 * getPath({ a: { b: { c: ['hey', 'Hi!'] } } }, 'a.b.c[1]') // Returns 'Hi!'
 * ```
 *
 * @param obj Any object.
 * @param path Path splitted by dots and `[]`. Like: `props.arr[1].nested`.
 * @returns The value for this path. Undefined if key is missing.
 */
export function getPath<T extends BaseDeepMap, K extends AllPaths<T>>(
  obj: T,
  path: K
): FromPath<T, K>

/**
 * Set a deep value by path. Copies are made at each level of `path` so that no
 * part of the original object is mutated (but it does not do a full deep copy
 * -- some sub-objects may still be shared between the old value and the new
 * one). Sparse arrays will be created if you set arbitrary length.
 *
 * ```
 * import { setPath } from 'nanostores'
 *
 * setPath({ a: { b: { c: [] } } }, 'a.b.c[1]', 'hey')
 * // Returns `{ a: { b: { c: [<empty>, 'hey'] } } }`
 * ```
 *
 * @param obj Any object.
 * @param path Path splitted by dots and `[]`. Like: `props.arr[1].nested`.
 * @returns The new object.
 */
export function setPath<T extends BaseDeepMap, K extends AllPaths<T>>(
  obj: T,
  path: K,
  value: FromPath<T, K>
): T

/**
 * Set a deep value by key. Copies are made at each level of `path` so that no
 * part of the original object is mutated (but it does not do a full deep copy
 * -- some sub-objects may still be shared between the old value and the new
 * one). Sparse arrays will be created if you set arbitrary length.
 *
 * ```
 * import { setByKey } from 'nanostores'
 *
 * setByKey({ a: { b: { c: [] } } }, ['a', 'b', 'c', 1], 'hey')
 * // Returns `{ a: { b: { c: [<empty>, 'hey'] } } }`
 * ```
 *
 * @param obj Any object.
 * @param splittedKeys An array of keys representing the path to the value.
 * @param value New value.
 * @retunts The new object.
 */
export function setByKey<T extends BaseDeepMap>(
  obj: T,
  splittedKeys: PropertyKey[],
  value: unknown
): T;
