import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path, { dirname } from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs/promises'
import { existsSync } from 'fs'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { LevelDB } = require('leveldb-zlib') as typeof import('leveldb-zlib')
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nbt = require('prismarine-nbt') as any

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ─── Window setup ────────────────────────────────────────────────────────────

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'PowerNBT',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ─── IPC: File System ────────────────────────────────────────────────────────

ipcMain.handle('fs:readFile', async (_e, filePath: string): Promise<Uint8Array | null> => {
  try {
    const buf = await fs.readFile(filePath)
    return new Uint8Array(buf)
  } catch {
    return null // file not found — let caller decide
  }
})

ipcMain.handle('fs:writeFile', async (_e, filePath: string, data: Uint8Array): Promise<void> => {
  await fs.writeFile(filePath, Buffer.from(data))
})

ipcMain.handle('fs:appendFile', async (_e, filePath: string, data: Uint8Array): Promise<void> => {
  // Use open+write+close for an explicit atomic append at end-of-file
  // to avoid any ambiguity with fs.appendFile buffering on Windows.
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof Uint8Array ? data : Object.values(data as Record<string, number>))
  console.log(`[main fs:appendFile] path=${filePath}  bytes=${buf.byteLength}`)
  const fh = await fs.open(filePath, 'a')
  try {
    const { bytesWritten } = await fh.write(buf)
    console.log(`[main fs:appendFile] bytesWritten=${bytesWritten}`)
  } finally {
    await fh.close()
  }
})

ipcMain.handle('fs:fileSize', async (_e, filePath: string): Promise<number> => {
  try {
    const stat = await fs.stat(filePath)
    return stat.size
  } catch {
    return 0
  }
})

ipcMain.handle('fs:exists', async (_e, filePath: string): Promise<boolean> => {
  return existsSync(filePath)
})

ipcMain.handle('fs:readdir', async (_e, dirPath: string): Promise<string[]> => {
  try {
    return await fs.readdir(dirPath)
  } catch {
    return []
  }
})

ipcMain.handle('fs:mkdir', async (_e, dirPath: string): Promise<void> => {
  await fs.mkdir(dirPath, { recursive: true })
})

// ─── IPC: Dialogs ────────────────────────────────────────────────────────────

ipcMain.handle('dialog:openDirectory', async (): Promise<string | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Open Minecraft Bedrock World Folder',
    properties: ['openDirectory'],
  })
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openFiles', async (
  _e,
  filters?: Electron.FileFilter[],
): Promise<string[] | null> => {
  const result = await dialog.showOpenDialog({
    title: 'Open NBT File',
    properties: ['openFile', 'multiSelections'],
    filters: filters ?? [
      { name: 'NBT Files', extensions: ['dat', 'nbt', 'mcstructure', 'dat_old'] },
    ],
  })
  return result.canceled ? null : result.filePaths
})

ipcMain.handle('dialog:saveFile', async (
  _e,
  defaultPath?: string,
): Promise<string | null> => {
  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: 'NBT File', extensions: ['dat', 'nbt'] }],
  })
  return result.canceled || !result.filePath ? null : result.filePath
})

// ─── IPC: Path utilities ─────────────────────────────────────────────────────

ipcMain.handle('path:join', (_e, ...parts: string[]): string => path.join(...parts))
ipcMain.handle('path:basename', (_e, p: string): string => path.basename(p))

// ─── IPC: LevelDB (via leveldb-zlib native module) ───────────────────────────

/** Open DB instances keyed by normalised dirPath */
const openDBs = new Map<string, InstanceType<typeof LevelDB>>()

ipcMain.handle('leveldb:open', async (_e, dirPath: string): Promise<void> => {
  if (openDBs.has(dirPath)) return // already open
  const db = new LevelDB(dirPath, { createIfMissing: false })
  await db.open()
  openDBs.set(dirPath, db)
})

ipcMain.handle('leveldb:close', async (_e, dirPath: string): Promise<void> => {
  const db = openDBs.get(dirPath)
  if (db) { await db.close(); openDBs.delete(dirPath) }
})

ipcMain.handle('leveldb:get', async (_e, dirPath: string, key: number[]): Promise<number[] | null> => {
  const db = openDBs.get(dirPath)
  if (!db) throw new Error(`DB not open: ${dirPath}`)
  const val = await db.get(Buffer.from(key))
  return val ? Array.from(val) : null
})

ipcMain.handle('leveldb:put', async (_e, dirPath: string, key: number[], value: number[]): Promise<void> => {
  const db = openDBs.get(dirPath)
  if (!db) throw new Error(`DB not open: ${dirPath}`)
  await db.put(Buffer.from(key), Buffer.from(value))
})

ipcMain.handle('leveldb:del', async (_e, dirPath: string, key: number[]): Promise<void> => {
  const db = openDBs.get(dirPath)
  if (!db) throw new Error(`DB not open: ${dirPath}`)
  await db.delete(Buffer.from(key))
})

ipcMain.handle('leveldb:batch', async (
  _e,
  dirPath: string,
  ops: Array<{ type: 'put' | 'del'; key: number[]; value?: number[] }>,
): Promise<void> => {
  const db = openDBs.get(dirPath)
  if (!db) throw new Error(`DB not open: ${dirPath}`)
  await db.batch(ops.map(op => ({
    type: op.type,
    key: Buffer.from(op.key),
    value: op.value ? Buffer.from(op.value) : undefined,
  })))
})

ipcMain.handle('leveldb:probeKeys', async (
  _e,
  dirPath: string,
  keys: number[][],
): Promise<number[][]> => {
  const db = openDBs.get(dirPath)
  if (!db) throw new Error(`DB not open: ${dirPath}`)
  const found: number[][] = []
  for (const k of keys) {
    const val = await db.get(Buffer.from(k))
    if (val !== null && val !== undefined) found.push(k)
  }
  return found
})

function prefixEnd(prefix: Buffer): Buffer {
  // Increment last byte to get exclusive upper bound for range scan
  const end = Buffer.from(prefix)
  for (let i = end.length - 1; i >= 0; i--) {
    if (end[i] < 0xff) { end[i]++; return end.slice(0, i + 1) }
  }
  return Buffer.alloc(0) // overflow: no upper bound needed
}

ipcMain.handle('leveldb:getKeysWithPrefix', async (
  _e,
  dirPath: string,
  prefix: number[],
): Promise<number[][]> => {
  const db = openDBs.get(dirPath)
  if (!db) throw new Error(`DB not open: ${dirPath}`)
  const prefixBuf = Buffer.from(prefix)
  const ltBuf = prefixEnd(prefixBuf)
  const opts: Record<string, unknown> = { keyAsBuffer: true, values: false, gte: prefixBuf }
  if (ltBuf.length > 0) opts.lt = ltBuf
  const result: number[][] = []
  for await (const entry of db.getIterator(opts)) {
    result.push(Array.from(entry[0] as Buffer))
  }
  return result
})

ipcMain.handle('leveldb:readAllKeys', async (
  _e,
  dirPath: string,
): Promise<number[][]> => {
  const db = openDBs.get(dirPath)
  if (!db) throw new Error(`DB not open: ${dirPath}`)
  const result: number[][] = []
  // values:false tells LevelDB not to decompress/read values from disk at all
  const iter = db.getIterator({ keyAsBuffer: true, values: false })
  // Use the async iterator — it always yields [key, value] regardless of options
  for await (const entry of iter) {
    result.push(Array.from(entry[0] as Buffer))
  }
  console.log(`[leveldb:readAllKeys] ${dirPath}: ${result.length} keys`)
  return result
})

ipcMain.handle('leveldb:readAll', async (
  _e,
  dirPath: string,
): Promise<Array<{ key: number[]; value: number[] }>> => {
  const db = openDBs.get(dirPath)
  if (!db) throw new Error(`DB not open: ${dirPath}`)
  const result: Array<{ key: number[]; value: number[] }> = []
  const iter = db.getIterator({ keyAsBuffer: true, valueAsBuffer: true })
  try {
    while (true) {
      const entry: Buffer[] = await iter.next()
      if (!entry || entry.length === 0) break
      // NOTE: leveldb-zlib iterator.next() returns [value, key] — not [key, value]
      result.push({ key: Array.from(entry[1]), value: Array.from(entry[0]) })
    }
  } finally {
    await iter.end()
  }
  console.log(`[leveldb:readAll] ${dirPath}: ${result.length} keys`)
  return result
})

// ─── IPC: NBT parse / serialize (prismarine-nbt runs in main to avoid eval in renderer) ───

ipcMain.handle('nbt:parse', async (
  _e,
  bytes: number[],
  littleEndianHint: boolean | null,
): Promise<{ pnbt: unknown; littleEndian: boolean }> => {
  const buf = Buffer.from(bytes)
  const formats: Array<'little' | 'big'> = littleEndianHint === true
    ? ['little']
    : littleEndianHint === false
      ? ['big']
      : ['little', 'big']
  const errors: string[] = []
  for (const fmt of formats) {
    try {
      const { parsed } = await nbt.parse(buf, fmt)
      return { pnbt: parsed, littleEndian: fmt === 'little' }
    } catch (e) {
      errors.push(`${fmt}: ${e}`)
    }
  }
  throw new Error(`Failed to parse NBT:\n${errors.join('\n')}`)
})

ipcMain.handle('nbt:serialize', (
  _e,
  pnbt: unknown,
  littleEndian: boolean,
): number[] => {
  const fmt = littleEndian ? 'little' : 'big'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buf: Buffer = nbt.writeUncompressed(pnbt as any, fmt)
  return Array.from(buf)
})
