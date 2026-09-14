import { contextBridge, ipcRenderer } from 'electron'
import type { ShellWindowApi } from '@/shared/shell'

const api: ShellWindowApi = {
  resizeContent: (height) => ipcRenderer.send('shell:resize', height),
  getDialogConfiguration: () => ipcRenderer.invoke('shell:configuration'),
  respond: (response) => ipcRenderer.send('shell:respond', response),
  server: {
    getConfiguration: () => ipcRenderer.invoke('server:get-configuration'),
    setOrigin: (origin) => ipcRenderer.invoke('server:set-origin', origin),
  },
}

contextBridge.exposeInMainWorld('simShell', api)
