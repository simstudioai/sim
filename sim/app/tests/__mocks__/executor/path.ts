export const PathTracker = jest.fn().mockImplementation(() => ({
  isInActivePath: jest.fn().mockReturnValue(true),
  updateExecutionPaths: jest.fn(),
}))
