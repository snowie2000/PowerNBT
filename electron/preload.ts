import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  fs: {
    readFile:   (p: string)                        => ipcRenderer.invoke('fs:readFile', p)   as Promise<Uint8Array | null>,
    writeFile:  (p: string, d: Uint8Array)         => ipcRenderer.invoke('fs:writeFile', p, d) as Promise<void>,
    appendFile: (p: string, d: Uint8Array)         => ipcRenderer.invoke('fs:appendFile', p, d) as Promise<void>,
    fileSize:   (p: string)                        => ipcRenderer.invoke('fs:fileSize', p)   as Promise<number>,
    exists:     (p: string)                        => ipcRenderer.invoke('fs:exists', p)     as Promise<boolean>,
    readdir:    (p: string)                        => ipcRenderer.invoke('fs:readdir', p)    as Promise<string[]>,
    mkdir:      (p: string)                        => ipcRenderer.invoke('fs:mkdir', p)      as Promise<void>,
  },
  dialog: {
    openDirectory: ()                              => ipcRenderer.invoke('dialog:openDirectory') as Promise<string | null>,
    openFiles: (filters?: {name: string, extensions: string[]}[]) =>
      ipcRenderer.invoke('dialog:openFiles', filters) as Promise<string[] | null>,
    saveFile:  (defaultPath?: string)              => ipcRenderer.invoke('dialog:saveFile', defaultPath) as Promise<string | null>,
  },
  path: {
    join:     (...parts: string[])                 => ipcRenderer.invoke('path:join', ...parts) as Promise<string>,
    basename: (p: string)                          => ipcRenderer.invoke('path:basename', p) as Promise<string>,
  },
  leveldb: {
    open:    (dirPath: string)                                                                 => ipcRenderer.invoke('leveldb:open', dirPath) as Promise<void>,
    close:   (dirPath: string)                                                                 => ipcRenderer.invoke('leveldb:close', dirPath) as Promise<void>,
    get:     (dirPath: string, key: number[])                                                  => ipcRenderer.invoke('leveldb:get', dirPath, key) as Promise<number[] | null>,
    put:     (dirPath: string, key: number[], value: number[])                                 => ipcRenderer.invoke('leveldb:put', dirPath, key, value) as Promise<void>,
    del:     (dirPath: string, key: number[])                                                  => ipcRenderer.invoke('leveldb:del', dirPath, key) as Promise<void>,
    batch:   (dirPath: string, ops: Array<{type:'put'|'del'; key:number[]; value?:number[]}>) => ipcRenderer.invoke('leveldb:batch', dirPath, ops) as Promise<void>,
    probeKeys: (dirPath: string, keys: number[][])                                             => ipcRenderer.invoke('leveldb:probeKeys', dirPath, keys) as Promise<number[][]>,
    getKeysWithPrefix: (dirPath: string, prefix: number[])                                    => ipcRenderer.invoke('leveldb:getKeysWithPrefix', dirPath, prefix) as Promise<number[][]>,
    readAllKeys: (dirPath: string)                                                             => ipcRenderer.invoke('leveldb:readAllKeys', dirPath) as Promise<number[][]>,
    readAll: (dirPath: string)                                                                 => ipcRenderer.invoke('leveldb:readAll', dirPath) as Promise<Array<{key:number[]; value:number[]}>>,
  },
})
