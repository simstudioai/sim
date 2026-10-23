/**
 * Sentinel default for `UPLOAD_DIR_SERVER`. The real value is `<process.cwd()>/uploads`; the mock
 * points at a non-writable absolute path instead so a test that forgets to set its own directory
 * fails loudly rather than writing into the checkout.
 */
const DEFAULT_UPLOAD_DIR_SERVER = '/test/uploads'

const state = { uploadDir: DEFAULT_UPLOAD_DIR_SERVER }

/**
 * Points the mocked `UPLOAD_DIR_SERVER` at `directory`. Reads through the mocked module observe
 * the new value immediately, so a suite can set a per-test temp directory in `beforeEach`.
 *
 * @example
 * ```ts
 * beforeEach(async () => {
 *   setUploadDirServer(await mkdtemp(join(tmpdir(), 'uploads-')))
 * })
 * ```
 */
export function setUploadDirServer(directory: string): void {
  state.uploadDir = directory
}

/** Restores `UPLOAD_DIR_SERVER` to the `/test/uploads` sentinel. */
export function resetUploadsSetupMock(): void {
  state.uploadDir = DEFAULT_UPLOAD_DIR_SERVER
}

/**
 * Static mock module for `@/lib/uploads/core/setup.server`. Mocking it also skips the real
 * module's import-time side effect (storage logging and local uploads-directory creation).
 * `UPLOAD_DIR_SERVER` is a getter over {@link setUploadDirServer}; defaults to `/test/uploads`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/uploads/core/setup.server', () => uploadsSetupMock)
 * setUploadDirServer(testUploadDirectory)
 * ```
 */
export const uploadsSetupMock = {
  get UPLOAD_DIR_SERVER() {
    return state.uploadDir
  },
}
