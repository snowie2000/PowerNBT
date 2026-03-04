import { app as u, BrowserWindow as h, ipcMain as l, dialog as p } from "electron";
import d, { dirname as B } from "path";
import { fileURLToPath as _ } from "url";
import c from "fs/promises";
import { existsSync as v } from "fs";
import { createRequire as $ } from "module";
const m = $(import.meta.url), { LevelDB: D } = m("leveldb-zlib"), b = m("prismarine-nbt"), E = _(import.meta.url), w = B(E);
function y() {
  const n = new h({
    width: 1400,
    height: 900,
    title: "PowerNBT",
    webPreferences: {
      preload: d.join(w, "preload.mjs"),
      contextIsolation: !0,
      nodeIntegration: !1
    }
  });
  process.env.VITE_DEV_SERVER_URL ? (n.loadURL(process.env.VITE_DEV_SERVER_URL), n.webContents.openDevTools()) : n.loadFile(d.join(w, "../dist/index.html"));
}
u.whenReady().then(() => {
  y(), u.on("activate", () => {
    h.getAllWindows().length === 0 && y();
  });
});
u.on("window-all-closed", () => {
  process.platform !== "darwin" && u.quit();
});
l.handle("fs:readFile", async (n, e) => {
  try {
    const t = await c.readFile(e);
    return new Uint8Array(t);
  } catch {
    return null;
  }
});
l.handle("fs:writeFile", async (n, e, t) => {
  await c.writeFile(e, Buffer.from(t));
});
l.handle("fs:appendFile", async (n, e, t) => {
  const r = Buffer.isBuffer(t) ? t : Buffer.from(t instanceof Uint8Array ? t : Object.values(t));
  console.log(`[main fs:appendFile] path=${e}  bytes=${r.byteLength}`);
  const o = await c.open(e, "a");
  try {
    const { bytesWritten: a } = await o.write(r);
    console.log(`[main fs:appendFile] bytesWritten=${a}`);
  } finally {
    await o.close();
  }
});
l.handle("fs:fileSize", async (n, e) => {
  try {
    return (await c.stat(e)).size;
  } catch {
    return 0;
  }
});
l.handle("fs:exists", async (n, e) => v(e));
l.handle("fs:readdir", async (n, e) => {
  try {
    return await c.readdir(e);
  } catch {
    return [];
  }
});
l.handle("fs:mkdir", async (n, e) => {
  await c.mkdir(e, { recursive: !0 });
});
l.handle("dialog:openDirectory", async () => {
  const n = await p.showOpenDialog({
    title: "Open Minecraft Bedrock World Folder",
    properties: ["openDirectory"]
  });
  return n.canceled || n.filePaths.length === 0 ? null : n.filePaths[0];
});
l.handle("dialog:openFiles", async (n, e) => {
  const t = await p.showOpenDialog({
    title: "Open NBT File",
    properties: ["openFile", "multiSelections"],
    filters: e ?? [
      { name: "NBT Files", extensions: ["dat", "nbt", "mcstructure", "dat_old"] }
    ]
  });
  return t.canceled ? null : t.filePaths;
});
l.handle("dialog:saveFile", async (n, e) => {
  const t = await p.showSaveDialog({
    defaultPath: e,
    filters: [{ name: "NBT File", extensions: ["dat", "nbt"] }]
  });
  return t.canceled || !t.filePath ? null : t.filePath;
});
l.handle("path:join", (n, ...e) => d.join(...e));
l.handle("path:basename", (n, e) => d.basename(e));
const s = /* @__PURE__ */ new Map();
l.handle("leveldb:open", async (n, e) => {
  if (s.has(e)) return;
  const t = new D(e, { createIfMissing: !1 });
  await t.open(), s.set(e, t);
});
l.handle("leveldb:close", async (n, e) => {
  const t = s.get(e);
  t && (await t.close(), s.delete(e));
});
l.handle("leveldb:get", async (n, e, t) => {
  const r = s.get(e);
  if (!r) throw new Error(`DB not open: ${e}`);
  const o = await r.get(Buffer.from(t));
  return o ? Array.from(o) : null;
});
l.handle("leveldb:put", async (n, e, t, r) => {
  const o = s.get(e);
  if (!o) throw new Error(`DB not open: ${e}`);
  await o.put(Buffer.from(t), Buffer.from(r));
});
l.handle("leveldb:del", async (n, e, t) => {
  const r = s.get(e);
  if (!r) throw new Error(`DB not open: ${e}`);
  await r.delete(Buffer.from(t));
});
l.handle("leveldb:batch", async (n, e, t) => {
  const r = s.get(e);
  if (!r) throw new Error(`DB not open: ${e}`);
  await r.batch(t.map((o) => ({
    type: o.type,
    key: Buffer.from(o.key),
    value: o.value ? Buffer.from(o.value) : void 0
  })));
});
l.handle("leveldb:probeKeys", async (n, e, t) => {
  const r = s.get(e);
  if (!r) throw new Error(`DB not open: ${e}`);
  const o = [];
  for (const a of t) {
    const i = await r.get(Buffer.from(a));
    i != null && o.push(a);
  }
  return o;
});
function A(n) {
  const e = Buffer.from(n);
  for (let t = e.length - 1; t >= 0; t--)
    if (e[t] < 255)
      return e[t]++, e.slice(0, t + 1);
  return Buffer.alloc(0);
}
l.handle("leveldb:getKeysWithPrefix", async (n, e, t) => {
  const r = s.get(e);
  if (!r) throw new Error(`DB not open: ${e}`);
  const o = Buffer.from(t), a = A(o), i = { keyAsBuffer: !0, values: !1, gte: o };
  a.length > 0 && (i.lt = a);
  const f = [];
  for await (const g of r.getIterator(i))
    f.push(Array.from(g[0]));
  return f;
});
l.handle("leveldb:readAllKeys", async (n, e) => {
  const t = s.get(e);
  if (!t) throw new Error(`DB not open: ${e}`);
  const r = [], o = t.getIterator({ keyAsBuffer: !0, values: !1 });
  for await (const a of o)
    r.push(Array.from(a[0]));
  return console.log(`[leveldb:readAllKeys] ${e}: ${r.length} keys`), r;
});
l.handle("leveldb:readAll", async (n, e) => {
  const t = s.get(e);
  if (!t) throw new Error(`DB not open: ${e}`);
  const r = [], o = t.getIterator({ keyAsBuffer: !0, valueAsBuffer: !0 });
  try {
    for (; ; ) {
      const a = await o.next();
      if (!a || a.length === 0) break;
      r.push({ key: Array.from(a[1]), value: Array.from(a[0]) });
    }
  } finally {
    await o.end();
  }
  return console.log(`[leveldb:readAll] ${e}: ${r.length} keys`), r;
});
l.handle("nbt:parse", async (n, e, t) => {
  const r = Buffer.from(e), o = t === !0 ? ["little"] : t === !1 ? ["big"] : ["little", "big"], a = [];
  for (const i of o)
    try {
      const { parsed: f } = await b.parse(r, i);
      return { pnbt: f, littleEndian: i === "little" };
    } catch (f) {
      a.push(`${i}: ${f}`);
    }
  throw new Error(`Failed to parse NBT:
${a.join(`
`)}`);
});
l.handle("nbt:serialize", (n, e, t) => {
  const r = t ? "little" : "big", o = b.writeUncompressed(e, r);
  return Array.from(o);
});
