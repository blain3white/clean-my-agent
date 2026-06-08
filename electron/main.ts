import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppSettings, ExportFormat } from '../src/shared/types'
import { AppService } from './lib/app-service'
import { UpdateService } from './lib/update-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appName = 'Clean My Agent'

let mainWindow: BrowserWindow | undefined
let service: AppService
let updateService: UpdateService

app.setName(appName)
app.setAboutPanelOptions({ applicationName: appName })

function getAppIconPath(): string {
  const candidates = [
    path.join(__dirname, '../../public/app-icon.png'),
    path.join(__dirname, '../renderer/app-icon.png'),
    path.join(process.resourcesPath, 'public/app-icon.png'),
    path.join(process.resourcesPath, 'app.asar.unpacked/public/app-icon.png'),
  ]

  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

function createWindow(): void {
  const iconPath = getAppIconPath()

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1040,
    minHeight: 700,
    title: appName,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    transparent: true,
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  app.dock?.setIcon(iconPath)

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

async function openTarget(targetPath: string): Promise<void> {
  if (/^https?:\/\//i.test(targetPath)) {
    await shell.openExternal(targetPath)
    return
  }

  const error = await shell.openPath(targetPath)
  if (error) throw new Error(error)
}

function registerIpc(): void {
  ipcMain.handle('app:getSnapshot', () => service.getSnapshot(false))
  ipcMain.handle('app:rescan', () => service.getSnapshot(true))
  ipcMain.handle('app:refreshRecentSessions', () => service.refreshRecentSessions(10))
  ipcMain.handle('skills:get', () => service.getSkills())
  ipcMain.handle('session:backup', (_event, sessionId: string) => service.backupSession(sessionId))
  ipcMain.handle('session:archive', (_event, sessionId: string) =>
    service.archiveSession(sessionId),
  )
  ipcMain.handle('archive:restore', (_event, archiveId: string) =>
    service.restoreArchive(archiveId),
  )
  ipcMain.handle('session:export', (_event, sessionId: string, format: ExportFormat) =>
    service.exportSession(sessionId, format),
  )
  ipcMain.handle('session:detail', (_event, sessionId: string) =>
    service.getSessionDetail(sessionId),
  )
  ipcMain.handle('cleanup:scan', () => service.scanCleanup())
  ipcMain.handle('cleanup:trash', (_event, candidateIds: string[]) =>
    service.moveCleanupToTrash(candidateIds),
  )
  ipcMain.handle('trash:purgeExpired', () => service.purgeExpiredTrash())
  ipcMain.handle('trash:restore', (_event, trashId: string) => service.restoreTrash(trashId))
  ipcMain.handle('relay:exportUniversal', (_event, sessionId: string) =>
    service.exportUniversalRelay(sessionId),
  )
  ipcMain.handle('settings:get', () => service.getSettings())
  ipcMain.handle('settings:update', (_event, settings: Partial<AppSettings>) =>
    service.updateSettings(settings),
  )
  ipcMain.handle('settings:chooseFolders', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'multiSelections', 'createDirectory'],
    })
    if (result.canceled) return []
    return result.filePaths
  })
  ipcMain.handle('shell:openPath', (_event, targetPath: string) => service.openPath(targetPath))
  ipcMain.handle('shell:beep', () => {
    shell.beep()
  })
  ipcMain.handle('diagnostics:export', () => service.exportDiagnostics())
  ipcMain.handle('app:getLaunchAtLogin', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('app:setLaunchAtLogin', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled })
    return app.getLoginItemSettings().openAtLogin
  })
  ipcMain.handle('app:checkForUpdates', () => updateService.checkForUpdates())
  ipcMain.handle('app:downloadLatestUpdate', () => updateService.downloadLatestUpdate())
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'system'
  service = new AppService({
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion(),
    openPath: openTarget,
  })
  updateService = new UpdateService({
    userDataPath: app.getPath('userData'),
    currentVersion: app.getVersion(),
  })
  await service.init()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
