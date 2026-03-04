/// <reference types="vite/client" />

interface ElectronAPI {
  fs: {
    readFile(path: string): Promise<Uint8Array | null>
    writeFile(path: string, data: Uint8Array): Promise<void>
    appendFile(path: string, data: Uint8Array): Promise<void>
    fileSize(path: string): Promise<number>
    exists(path: string): Promise<boolean>
    readdir(path: string): Promise<string[]>
    mkdir(path: string): Promise<void>
  }
  dialog: {
    openDirectory(): Promise<string | null>
    openFiles(filters?: { name: string; extensions: string[] }[]): Promise<string[] | null>
    saveFile(defaultPath?: string): Promise<string | null>
  }
  path: {
    join(...parts: string[]): Promise<string>
    basename(path: string): Promise<string>
  }
  leveldb: {
    open(dirPath: string): Promise<void>
    close(dirPath: string): Promise<void>
    get(dirPath: string, key: number[]): Promise<number[] | null>
    put(dirPath: string, key: number[], value: number[]): Promise<void>
    del(dirPath: string, key: number[]): Promise<void>
    batch(dirPath: string, ops: Array<{ type: 'put' | 'del'; key: number[]; value?: number[] }>): Promise<void>
    probeKeys(dirPath: string, keys: number[][]): Promise<number[][]>
    getKeysWithPrefix(dirPath: string, prefix: number[]): Promise<number[][]>
    readAllKeys(dirPath: string): Promise<number[][]>
    readAll(dirPath: string): Promise<Array<{ key: number[]; value: number[] }>>
  }
  nbt: {
    parse(bytes: number[], littleEndianHint: boolean | null): Promise<{ pnbt: unknown; littleEndian: boolean }>
    serialize(pnbt: unknown, littleEndian: boolean): Promise<number[]>
  }
}

declare interface Window {
  electronAPI: ElectronAPI
}
