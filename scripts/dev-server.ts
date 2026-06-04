import { spawn } from 'node:child_process'
import net from 'node:net'

const portRange = Array.from({ length: 10 }, (_, index) => 14000 + index)
const mode = process.argv[2] === 'electron' ? 'electron' : 'renderer'

async function isPortAvailable(port: number) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

async function findPort() {
  for (const port of portRange) {
    if (await isPortAvailable(port)) return port
  }
  throw new Error(`No available dev server port in ${portRange[0]}-${portRange.at(-1)}`)
}

const port = await findPort()
const command = mode === 'electron' ? 'electron-vite' : 'vite'
const args =
  mode === 'electron' ? ['dev'] : ['--host', '127.0.0.1', '--port', String(port), '--strictPort']

console.log(`Starting ${mode} dev server on http://127.0.0.1:${port}`)

const child = spawn(command, args, {
  env: {
    ...process.env,
    CMA_DEV_PORT: String(port),
  },
  shell: true,
  stdio: 'inherit',
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 0)
})
