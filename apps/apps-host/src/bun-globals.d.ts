/** Ambient stubs so apps-host typechecks without a full @types/bun / @types/node install. */

declare const process: {
  env: Record<string, string | undefined>
  exit(code?: number): never
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string
  export const sep: string
}

declare module 'node:fs/promises' {
  export function lstat(path: string): Promise<{ isSymbolicLink(): boolean }>
  export function realpath(path: string): Promise<string>
  export function readFile(path: string): Promise<Buffer>
}

declare module 'node:crypto' {
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array | Buffer): { digest(encoding: string): string }
  }
  export function createHmac(
    algorithm: string,
    key: string
  ): { update(data: string, encoding?: string): { digest(encoding: string): string } }
  export function timingSafeEqual(a: Buffer, b: Buffer): boolean
}

declare const Buffer: {
  from(data: Uint8Array | string): Buffer
}

interface Buffer extends Uint8Array {}

declare const Bun: {
  file(path: string): Blob & {
    exists(): Promise<boolean>
  }
  serve(options: {
    port: number
    fetch(req: Request): Response | Promise<Response>
  }): {
    port: number
    requestIP?(req: Request): string | { address: string } | null | undefined
  }
}
