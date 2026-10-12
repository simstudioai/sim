import { describe, expect, it } from 'vitest'
import { processCodeFailure } from '@/lib/execution/remote-sandbox/code-failure'

/** Node 22's crash report when `fetch` loses its socket before any response bytes. */
const FETCH_SOCKET_CLOSED = `node:internal/deps/undici/undici:13510
      Error.captureStackTrace(err);
            ^

TypeError: fetch failed
    at node:internal/deps/undici/undici:13510:13
    at async file:///home/user/.sim-function-abc.mjs:1:1 {
  [cause]: SocketError: other side closed
      at Socket.<anonymous> (node:internal/deps/undici/undici:6294:28)
      at process.processTicksAndRejections (node:internal/process/task_queues:90:21) {
    code: 'UND_ERR_SOCKET',
    socket: {
      remotePort: 443,
      timeout: undefined,
      bytesWritten: 171,
      bytesRead: 0
    }
  }
}

Node.js v22.19.0
`

/** An error carrying its own properties, which Node prints indented after the stack. */
const CUSTOM_ERROR_WITH_PROPERTIES = `file:///home/user/.sim-function-abc.mjs:1
throw new QuotaExceeded('over quota')
^

QuotaExceeded: over quota
    at file:///home/user/.sim-function-abc.mjs:1:109 {
  limit: 5
}

Node.js v22.19.0
`

const NODE_CODED_ERROR = `node:internal/modules/package_json_reader:266
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base), null);
        ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'left-pad' imported from /home/user/.sim-function-abc.mjs
    at packageResolve (node:internal/modules/esm/resolve:767:81) {
  code: 'ERR_MODULE_NOT_FOUND'
}

Node.js v22.19.0
`

/** An error printed without a stack (here a rejected `Promise.any`), bracketed by Node. */
const STACKLESS_ERROR = `node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

[AggregateError: All promises were rejected] {
  [errors]: [
    Error: a
        at file:///home/user/.sim-function-abc.mjs:1:35,
    Error: b
        at file:///home/user/.sim-function-abc.mjs:1:67
  ]
}

Node.js v22.19.0
`

/** A thrown non-error leaves only Node's source-location header, which is not an error name. */
const THROWN_STRING = `
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^
just a string
(Use \`node --trace-uncaught ...\` to show where the exception was thrown)

Node.js v22.19.0
`

/** A thrown non-error object Node labels in brackets, like an error printed without a stack. */
const THROWN_NULL_PROTOTYPE_OBJECT = `
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^
[Object: null prototype] {
  alpha: 'x',
  gamma: 3
}

Node.js v22.19.0
`

const THROWN_FUNCTION = `
node:internal/modules/run_main:123
    triggerUncaughtException(
    ^
[Function: myHandler]

Node.js v22.19.0
`

const STACKLESS_RANGE_ERROR = `file:///home/user/.sim-function-abc.mjs:1
throw e
^

[RangeError: limit hit]

Node.js v22.19.0
`

const STACKLESS_PLAIN_ERROR = `file:///home/user/.sim-function-abc.mjs:1
throw e
^

[Error: plain failure]

Node.js v22.19.0
`

/** A stackless error whose class keeps its parent's `name`, annotated by Node. */
const STACKLESS_SUBCLASS_ERROR = `node:internal/modules/run_main:123
    triggerUncaughtException(
    ^

[QuotaExceeded [Error]: over quota] { code: 'E_Q' }

Node.js v22.19.0
`

const STACKLESS_ERROR_WITH_INLINE_PROPERTIES = `file:///home/user/.sim-function-abc.mjs:1
throw e
^

[TypeError: bad thing] { code: 'E1' }

Node.js v22.19.0
`

const STACKLESS_MULTILINE_ERROR = `file:///home/user/.sim-function-abc.mjs:1
throw e
^

[TypeError: first line
second line] {
  code: 'E2'
}

Node.js v22.19.0
`

const PYTHON_TRACEBACK = `Traceback (most recent call last):
  File "/home/user/.sim-function-abc.py", line 2, in <module>
    raise QuotaExceeded('over quota')
__main__.QuotaExceeded: over quota
`

describe('processCodeFailure', () => {
  it.each([
    ['a fetch that lost its socket', FETCH_SOCKET_CLOSED, 'TypeError', 'fetch failed'],
    [
      'an error with its own properties',
      CUSTOM_ERROR_WITH_PROPERTIES,
      'QuotaExceeded',
      'over quota',
    ],
    [
      "Node's coded error",
      NODE_CODED_ERROR,
      'Error [ERR_MODULE_NOT_FOUND]',
      "Cannot find package 'left-pad' imported from /home/user/.sim-function-abc.mjs",
    ],
    [
      'an error printed without a stack',
      STACKLESS_ERROR,
      'AggregateError',
      'All promises were rejected',
    ],
    ['a stackless error with no properties', STACKLESS_RANGE_ERROR, 'RangeError', 'limit hit'],
    ['a stackless plain Error', STACKLESS_PLAIN_ERROR, 'Error', 'plain failure'],
    ['a stackless error subclass', STACKLESS_SUBCLASS_ERROR, 'QuotaExceeded [Error]', 'over quota'],
    [
      'a stackless error with inline properties',
      STACKLESS_ERROR_WITH_INLINE_PROPERTIES,
      'TypeError',
      'bad thing',
    ],
    ['a stackless multiline error', STACKLESS_MULTILINE_ERROR, 'TypeError', 'first line'],
    ['a thrown string', THROWN_STRING, 'Error', 'Execution failed'],
    ['a thrown null-prototype object', THROWN_NULL_PROTOTYPE_OBJECT, 'Error', 'Execution failed'],
    ['a thrown function', THROWN_FUNCTION, 'Error', 'Execution failed'],
    ['a Python traceback', PYTHON_TRACEBACK, '__main__.QuotaExceeded', 'over quota'],
  ])('names the error of %s from its headline', (_case, stderr, name, value) => {
    const { error } = processCodeFailure({ stdout: '', stderr, exitCode: 1 })

    expect(error).toEqual({ name, value, traceback: stderr })
  })

  it('reads the traceback from stdout when stderr is empty', () => {
    const { error } = processCodeFailure({ stdout: PYTHON_TRACEBACK, stderr: '', exitCode: 1 })

    expect(error?.name).toBe('__main__.QuotaExceeded')
  })
})
