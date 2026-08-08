/**
 * The collaborative socket connection, as a React context.
 *
 * Lives in `components/` rather than under a route tree because it has
 * consumers on both sides of one: the workspace editor mounts the provider,
 * and the file view's collaborative editing hook reads it from inside a
 * canonical resource unit that anonymous surfaces also mount. A provider under
 * `app/workspace/**` made that second consumer an authenticated-tree import.
 */
export { SocketProvider, useSocket } from './socket-provider'
