import { app, BrowserWindow, ipcMain, dialog } from "electron";
import path, { dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";
import { existsSync } from "fs";
import { createRequire } from "module";
const require$1 = createRequire(import.meta.url);
const { LevelDB } = require$1("leveldb-zlib");
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = dirname(__filename$1);
function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "PowerNBT",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname$1, "../dist/index.html"));
  }
}
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
ipcMain.handle("fs:readFile", async (_e, filePath) => {
  try {
    const buf = await fs.readFile(filePath);
    return new Uint8Array(buf);
  } catch {
    return null;
  }
});
ipcMain.handle("fs:writeFile", async (_e, filePath, data) => {
  await fs.writeFile(filePath, Buffer.from(data));
});
ipcMain.handle("fs:appendFile", async (_e, filePath, data) => {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof Uint8Array ? data : Object.values(data));
  console.log(`[main fs:appendFile] path=${filePath}  bytes=${buf.byteLength}`);
  const fh = await fs.open(filePath, "a");
  try {
    const { bytesWritten } = await fh.write(buf);
    console.log(`[main fs:appendFile] bytesWritten=${bytesWritten}`);
  } finally {
    await fh.close();
  }
});
ipcMain.handle("fs:fileSize", async (_e, filePath) => {
  try {
    const stat = await fs.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
});
ipcMain.handle("fs:exists", async (_e, filePath) => {
  return existsSync(filePath);
});
ipcMain.handle("fs:readdir", async (_e, dirPath) => {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
});
ipcMain.handle("fs:mkdir", async (_e, dirPath) => {
  await fs.mkdir(dirPath, { recursive: true });
});
ipcMain.handle("dialog:openDirectory", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open Minecraft Bedrock World Folder",
    properties: ["openDirectory"]
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
});
ipcMain.handle("dialog:openFiles", async (_e, filters) => {
  const result = await dialog.showOpenDialog({
    title: "Open NBT File",
    properties: ["openFile", "multiSelections"],
    filters: filters ?? [
      { name: "NBT Files", extensions: ["dat", "nbt", "mcstructure", "dat_old"] }
    ]
  });
  return result.canceled ? null : result.filePaths;
});
ipcMain.handle("dialog:saveFile", async (_e, defaultPath) => {
  const result = await dialog.showSaveDialog({
    defaultPath,
    filters: [{ name: "NBT File", extensions: ["dat", "nbt"] }]
  });
  return result.canceled || !result.filePath ? null : result.filePath;
});
ipcMain.handle("path:join", (_e, ...parts) => path.join(...parts));
ipcMain.handle("path:basename", (_e, p) => path.basename(p));
const openDBs = /* @__PURE__ */ new Map();
ipcMain.handle("leveldb:open", async (_e, dirPath) => {
  if (openDBs.has(dirPath)) return;
  const db = new LevelDB(dirPath, { createIfMissing: false });
  await db.open();
  openDBs.set(dirPath, db);
});
ipcMain.handle("leveldb:close", async (_e, dirPath) => {
  const db = openDBs.get(dirPath);
  if (db) {
    await db.close();
    openDBs.delete(dirPath);
  }
});
ipcMain.handle("leveldb:get", async (_e, dirPath, key) => {
  const db = openDBs.get(dirPath);
  if (!db) throw new Error(`DB not open: ${dirPath}`);
  const val = await db.get(Buffer.from(key));
  return val ? Array.from(val) : null;
});
ipcMain.handle("leveldb:put", async (_e, dirPath, key, value) => {
  const db = openDBs.get(dirPath);
  if (!db) throw new Error(`DB not open: ${dirPath}`);
  await db.put(Buffer.from(key), Buffer.from(value));
});
ipcMain.handle("leveldb:del", async (_e, dirPath, key) => {
  const db = openDBs.get(dirPath);
  if (!db) throw new Error(`DB not open: ${dirPath}`);
  await db.delete(Buffer.from(key));
});
ipcMain.handle("leveldb:batch", async (_e, dirPath, ops) => {
  const db = openDBs.get(dirPath);
  if (!db) throw new Error(`DB not open: ${dirPath}`);
  await db.batch(ops.map((op) => ({
    type: op.type,
    key: Buffer.from(op.key),
    value: op.value ? Buffer.from(op.value) : void 0
  })));
});
ipcMain.handle("leveldb:readAll", async (_e, dirPath) => {
  const db = openDBs.get(dirPath);
  if (!db) throw new Error(`DB not open: ${dirPath}`);
  const result = [];
  const iter = db.getIterator({ keyAsBuffer: true, valueAsBuffer: true });
  try {
    while (true) {
      const entry = await iter.next();
      if (!entry || entry.length === 0) break;
      result.push({ key: Array.from(entry[1]), value: Array.from(entry[0]) });
    }
  } finally {
    await iter.end();
  }
  console.log(`[leveldb:readAll] ${dirPath}: ${result.length} keys`);
  return result;
});
