import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AppSettings, ExportFormat } from '../src/shared/types'
import { AppService } from './lib/app-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | undefined
let service: AppService

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
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 700,
    title: 'Clean My Agent',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'sidebar',
    visualEffectState: 'active',
    backgroundColor: '#101112',
    icon: iconPath,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
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

function registerIpc(): void {
  ipcMain.handle('app:getSnapshot', () => service.getSnapshot(false))
  ipcMain.handle('app:rescan', () => service.getSnapshot(true))
  ipcMain.handle('session:backup', (_event, sessionId: string) => service.backupSession(sessionId))
  ipcMain.handle('session:export', (_event, sessionId: string, format: ExportFormat) =>
    service.exportSession(sessionId, format),
  )
  ipcMain.handle('cleanup:scan', () => service.scanCleanup())
  ipcMain.handle('cleanup:trash', (_event, candidateIds: string[]) =>
    service.moveCleanupToTrash(candidateIds),
  )
  ipcMain.handle('trash:restore', (_event, trashId: string) => service.restoreTrash(trashId))
  ipcMain.handle('relay:exportUniversal', (_event, sessionId: string) =>
    service.exportUniversalRelay(sessionId),
  )
  ipcMain.handle('settings:get', () => service.getSettings())
  ipcMain.handle('settings:update', (_event, settings: Partial<AppSettings>) =>
    service.updateSettings(settings),
  )
  ipcMain.handle('shell:openPath', (_event, targetPath: string) => service.openPath(targetPath))
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'system'
  service = new AppService({ userDataPath: app.getPath('userData'), openPath: shell.openPath })
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
