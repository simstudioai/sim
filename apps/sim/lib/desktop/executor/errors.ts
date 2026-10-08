/**
 * The device is not registered to this user under this session, or it was revoked. The device
 * should register again; a 401 tells it so without saying whose device the id belongs to.
 */
export class DesktopDeviceUnrecognizedError extends Error {
  constructor() {
    super('This desktop is not registered for this session. Register it again.')
    this.name = 'DesktopDeviceUnrecognizedError'
  }
}

/** The call no longer belongs to the token that presented it: stop the local action. */
export class DesktopCallRevokedError extends Error {
  constructor() {
    super('This call was stopped or settled. Stop running it.')
    this.name = 'DesktopCallRevokedError'
  }
}
