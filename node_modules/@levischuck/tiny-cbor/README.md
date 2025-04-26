# Tiny CBOR

[![](https://img.shields.io/github/actions/workflow/status/levischuck/tiny-cbor/build.yaml?branch=main&style=flat-square)](https://github.com/LeviSchuck/tiny-cbor/actions)
[![](https://img.shields.io/codecov/c/gh/levischuck/tiny-cbor?style=flat-square)](https://codecov.io/gh/levischuck/tiny-cbor)
[![](https://img.shields.io/github/v/tag/levischuck/tiny-cbor?label=npm&logo=npm&style=flat-square)](https://www.npmjs.com/package/@levischuck/tiny-cbor)
[![](https://img.shields.io/jsr/v/%40levischuck/tiny-cbor?style=flat-square&logo=jsr&label=JSR)](https://jsr.io/@levischuck/tiny-cbor)
[![](https://img.shields.io/github/license/levischuck/tiny-cbor?style=flat-square)](https://github.com/LeviSchuck/tiny-cbor/blob/main/LICENSE.txt)
![](https://img.shields.io/bundlephobia/min/%40levischuck/tiny-cbor?style=flat-square)

This minimal generic library decodes and encodes most useful CBOR structures
into simple JavaScript structures:

- Maps with keys as `string`s or `number`s with `CBORType` values as a `Map`
- Arrays of `CBORType` values
- integers as `number`s
- float32 and float64 as `number`s
- float16 `NaN`, `Infinity`, `-Infinity`
- `string`s
- byte strings as `Uint8Array`
- booleans
- `null` and `undefined`
- tags as `CBORTag(tag, value)`

## Limitations

This implementation does not support:

- indefinite length maps, arrays, text strings, or byte strings.
- half precision floating point numbers
- integers outside the range of `[-9007199254740991, 9007199254740991]`, see
  [Number.MAX_SAFE_INTEGER](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Number/MAX_SAFE_INTEGER)
- native output to JSON
- does not support generic objects, only `Map`s

This implementation has the following constraints:

- Map keys may only be strings or numbers
- Tags are not interpreted

## Behavior

Maps that have duplicate keys will throw an error during decoding. Decoding data
that is incomplete will throw an error during decoding.

## Example

```ts
// NPM
// import { decodeCBOR } from "@levischuck/tiny-cbor";
// or JSR
// import { decodeCBOR } from "jsr:@levischuck/tiny-cbor";
import { decodeCBOR } from "./index.ts";
// Get your bytes somehow, directly or with decodeBase64 / decodeHex (available through @levischuck/tiny-encodings)
const HELLO_WORLD_BYTES = new Uint8Array([
  107, // String wih length 11
  104, // h
  101, // e
  108, // l
  108, // l
  111, // o
  32, // Space
  119, // w
  111, // o
  114, // r
  108, // l
  100, // d
]);
const helloWorld = decodeCBOR(HELLO_WORLD_BYTES);
if ("hello world" == helloWorld) {
  console.log("Success!");
}
```

## Where to get it

This library is available on
[NPM](https://www.npmjs.com/package/@levischuck/tiny-cbor) and
[JSR](https://jsr.io/@levischuck/tiny-cbor).

This library is no longer automatically published to Deno's Third Party Modules.
Newer versions may appear on deno.land/x, but do not work.
