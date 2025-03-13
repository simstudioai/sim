export const InputResolver = jest.fn().mockImplementation(() => ({
  resolveInputs: jest.fn().mockReturnValue({}),
  resolveBlockReferences: jest.fn().mockImplementation((val) => val),
  resolveEnvVariables: jest.fn().mockImplementation((val) => val),
}))
