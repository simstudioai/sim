import { contextBridge, ipcRenderer } from 'electron'
import { exposeShellTheme } from '@/preload/shell-theme'
import type { CredentialPickerApi } from '@/shared/browser-credentials'

const api: CredentialPickerApi = {
  configuration: () => ipcRenderer.invoke('credential-picker:configuration'),
  select: (id) => ipcRenderer.invoke('credential-picker:select', id),
  dismiss: () => ipcRenderer.send('credential-picker:dismiss'),
  resize: (height) => ipcRenderer.send('credential-picker:resize', height),
}

contextBridge.exposeInMainWorld('simCredentialPicker', api)
exposeShellTheme()
