/** The fixture may publish only synthetic test state to its own local main process. */
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('fixture', {
  publish: (state) => ipcRenderer.send('fixture:state', state),
})
