export function createRequest(host: string) {
  return {
    url: () => `${host}/api/tools/test`,
    method: 'POST',
  }
}
