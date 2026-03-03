"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  fs: {
    readFile: (p) => electron.ipcRenderer.invoke("fs:readFile", p),
    writeFile: (p, d) => electron.ipcRenderer.invoke("fs:writeFile", p, d),
    appendFile: (p, d) => electron.ipcRenderer.invoke("fs:appendFile", p, d),
    fileSize: (p) => electron.ipcRenderer.invoke("fs:fileSize", p),
    exists: (p) => electron.ipcRenderer.invoke("fs:exists", p),
    readdir: (p) => electron.ipcRenderer.invoke("fs:readdir", p),
    mkdir: (p) => electron.ipcRenderer.invoke("fs:mkdir", p)
  },
  dialog: {
    openDirectory: () => electron.ipcRenderer.invoke("dialog:openDirectory"),
    openFiles: (filters) => electron.ipcRenderer.invoke("dialog:openFiles", filters),
    saveFile: (defaultPath) => electron.ipcRenderer.invoke("dialog:saveFile", defaultPath)
  },
  path: {
    join: (...parts) => electron.ipcRenderer.invoke("path:join", ...parts),
    basename: (p) => electron.ipcRenderer.invoke("path:basename", p)
  },
  leveldb: {
    open: (dirPath) => electron.ipcRenderer.invoke("leveldb:open", dirPath),
    close: (dirPath) => electron.ipcRenderer.invoke("leveldb:close", dirPath),
    get: (dirPath, key) => electron.ipcRenderer.invoke("leveldb:get", dirPath, key),
    put: (dirPath, key, value) => electron.ipcRenderer.invoke("leveldb:put", dirPath, key, value),
    del: (dirPath, key) => electron.ipcRenderer.invoke("leveldb:del", dirPath, key),
    batch: (dirPath, ops) => electron.ipcRenderer.invoke("leveldb:batch", dirPath, ops),
    probeKeys: (dirPath, keys) => electron.ipcRenderer.invoke("leveldb:probeKeys", dirPath, keys),
    getKeysWithPrefix: (dirPath, prefix) => electron.ipcRenderer.invoke("leveldb:getKeysWithPrefix", dirPath, prefix),
    readAllKeys: (dirPath) => electron.ipcRenderer.invoke("leveldb:readAllKeys", dirPath),
    readAll: (dirPath) => electron.ipcRenderer.invoke("leveldb:readAll", dirPath)
  }
});
