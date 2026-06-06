import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, CleanMyAgentApi, ExportFormat } from '../src/shared/types'

const api: CleanMyAgentApi = {
  getSnapshot: () => ipcRenderer.invoke('app:getSnapshot'),
  rescan: () => ipcRenderer.invoke('app:rescan'),
  refreshRecentSessions: () => ipcRenderer.invoke('app:refreshRecentSessions'),
  backupSession: (sessionId: string) => ipcRenderer.invoke('session:backup', sessionId),
  archiveSession: (sessionId: string) => ipcRenderer.invoke('session:archive', sessionId),
  restoreArchive: (archiveId: string) => ipcRenderer.invoke('archive:restore', archiveId),
  exportSession: (sessionId: string, format: ExportFormat) =>
    ipcRenderer.invoke('session:export', sessionId, format),
  scanCleanup: (sessionId?: string) => ipcRenderer.invoke('cleanup:scan', sessionId),
  moveCleanupToTrash: (candidateIds: string[]) => ipcRenderer.invoke('cleanup:trash', candidateIds),
  purgeExpiredTrash: () => ipcRenderer.invoke('trash:purgeExpired'),
  restoreTrash: (trashId: string) => ipcRenderer.invoke('trash:restore', trashId),
  exportUniversalRelay: (sessionId: string) =>
    ipcRenderer.invoke('relay:exportUniversal', sessionId),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', settings),
  chooseFolders: () => ipcRenderer.invoke('settings:chooseFolders'),
  openPath: (path: string) => ipcRenderer.invoke('shell:openPath', path),
  playSystemSound: () => ipcRenderer.invoke('shell:beep'),
  getLaunchAtLogin: () => ipcRenderer.invoke('app:getLaunchAtLogin'),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke('app:setLaunchAtLogin', enabled),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  downloadLatestUpdate: () => ipcRenderer.invoke('app:downloadLatestUpdate'),
}

contextBridge.exposeInMainWorld('cleanMyAgent', api)
