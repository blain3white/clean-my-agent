import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, CleanMyAgentApi, ExportFormat } from '../src/shared/types'

const api: CleanMyAgentApi = {
  getSnapshot: () => ipcRenderer.invoke('app:getSnapshot'),
  rescan: () => ipcRenderer.invoke('app:rescan'),
  backupSession: (sessionId: string) => ipcRenderer.invoke('session:backup', sessionId),
  archiveSession: (sessionId: string) => ipcRenderer.invoke('session:archive', sessionId),
  restoreArchive: (archiveId: string) => ipcRenderer.invoke('archive:restore', archiveId),
  exportSession: (sessionId: string, format: ExportFormat) =>
    ipcRenderer.invoke('session:export', sessionId, format),
  scanCleanup: (sessionId?: string) => ipcRenderer.invoke('cleanup:scan', sessionId),
  moveCleanupToTrash: (candidateIds: string[]) => ipcRenderer.invoke('cleanup:trash', candidateIds),
  restoreTrash: (trashId: string) => ipcRenderer.invoke('trash:restore', trashId),
  exportUniversalRelay: (sessionId: string) =>
    ipcRenderer.invoke('relay:exportUniversal', sessionId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', settings),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
}

contextBridge.exposeInMainWorld('cleanMyAgent', api)
