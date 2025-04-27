export interface Task<Value> extends Promise<Value> {
  t: true
}

/**
 * Track store async task by start/end functions.
 * It is useful for test to wait end of the processing.
 *
 * It you use `async`/`await` in task, you can use {@link task}.
 *
 * ```ts
 * import { startTask } from 'nanostores'
 *
 * function saveUser () {
 *   const endTask = startTask()
 *   api.submit('/user', user.get(), () => {
 *     $user.setKey('saved', true)
 *     endTask()
 *   })
 * }
 * ```
 */
export function startTask(): () => void

/**
 * Track store async task by wrapping promise callback.
 * It is useful for test to wait end of the processing.
 *
 * ```ts
 * import { task } from 'nanostores'
 *
 * async function saveUser () {
 *   await task(async () => {
 *     await api.submit('/user', user.get())
 *     $user.setKey('saved', true)
 *   })
 * }
 * ```
 *
 * @param cb Async callback with task.
 * @return Return value from callback.
 */
export function task<Return = never>(
  cb: () => Promise<Return> | Return
): Task<Return>

/**
 * Return Promise until all current tasks (and tasks created while waiting).
 *
 * It is useful in tests to wait all async processes in the stores.
 *
 * ```ts
 * import { allTasks } from 'nanostores'
 *
 * it('saves user', async () => {
 *   saveUser()
 *   await allTasks()
 *   expect($user.get().saved).toBe(true)
 * })
 * ```
 */
export function allTasks(): Promise<void>

/**
 * Forget all tracking tasks. Use it only for tests.
 * {@link cleanStores} cleans tasks automatically.
 *
 * ```js
 * import { cleanTasks } from 'nanostores'
 *
 * afterEach(() => {
 *   cleanTasks()
 * })
 * ```
 */
export function cleanTasks(): void
