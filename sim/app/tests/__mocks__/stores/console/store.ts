export const useConsoleStore = {
  getState: jest.fn().mockReturnValue({
    addConsole: jest.fn(),
  }),
}
