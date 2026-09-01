export {}

declare global {
  interface Window {
    /** Runtime `NEXT_PUBLIC_*` values assigned before application hydration. */
    __ENV?: NodeJS.ProcessEnv
  }
}
