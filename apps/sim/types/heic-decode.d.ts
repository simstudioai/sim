/**
 * `heic-decode` ships no types. Only the surface we use is declared: `all()`
 * reports each image's declared dimensions and defers the decode, which is what
 * lets a caller refuse an oversized one before any raster is allocated.
 */
declare module 'heic-decode' {
  interface DecodedHeifImage {
    width: number
    height: number
    data: Uint8ClampedArray
  }

  interface HeifImageHandle {
    width: number
    height: number
    decode: () => Promise<DecodedHeifImage>
  }

  function decode(options: { buffer: Buffer }): Promise<DecodedHeifImage>

  namespace decode {
    function all(options: { buffer: Buffer }): Promise<HeifImageHandle[]>
  }

  export = decode
}
