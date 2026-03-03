import { useCallback } from 'react'
import { parseNbt, serializeNbt } from '../lib/nbt/parser'
import { BedrockLevelDB } from '../lib/leveldb/db'
import { useEditorStore } from '../store/useEditorStore'
import type { NbtDocument } from '../lib/nbt/types'

declare global {
  interface Window {
    showOpenFilePicker: (opts?: Record<string, unknown>) => Promise<FileSystemFileHandle[]>
    showSaveFilePicker: (opts?: Record<string, unknown>) => Promise<FileSystemFileHandle>
    showDirectoryPicker: (opts?: Record<string, unknown>) => Promise<FileSystemDirectoryHandle>
  }
}

export function useFileSystem() {
  const { openNbtFile, openLevelDB, markClean } = useEditorStore()

  /** Open one or more standalone NBT files */
  const openNbtFiles = useCallback(async () => {
    if (!window.showOpenFilePicker) {
      alert('Your browser does not support the File System Access API. Please use Chrome or Edge.')
      return
    }
    let handles: FileSystemFileHandle[]
    try {
      handles = await window.showOpenFilePicker({
        multiple: true,
        types: [
          {
            description: 'NBT files',
            accept: {
              'application/octet-stream': ['.dat', '.nbt', '.mcstructure', '.dat_old'],
            },
          },
        ],
      })
    } catch {
      return // user cancelled
    }

    for (const handle of handles) {
      try {
        const file = await handle.getFile()
        const buf = await file.arrayBuffer()
        const doc = await parseNbt(buf, { kind: 'file', handle })
        openNbtFile(doc, file.name)
      } catch (e) {
        console.error(`Failed to open ${handle.name}:`, e)
        alert(`Failed to read ${handle.name}: ${e}`)
      }
    }
  }, [openNbtFile])

  /** Open a Minecraft Bedrock world folder */
  const openWorldFolder = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      alert('Your browser does not support directory picking. Please use Chrome or Edge.')
      return
    }
    let dirHandle: FileSystemDirectoryHandle
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' })
    } catch {
      return // user cancelled
    }

    // Verify it looks like a Bedrock world by checking for level.dat and db/
    let hasLevelDat = false
    try {
      await dirHandle.getFileHandle('level.dat')
      hasLevelDat = true
    } catch { /* not found */ }
    try {
      await dirHandle.getDirectoryHandle('db')
    } catch { /* not found */ }

    // Also allow opening when the db/ directory itself is selected
    let dbHandle: FileSystemDirectoryHandle
    try {
      dbHandle = await dirHandle.getDirectoryHandle('db')
    } catch {
      // Maybe user selected the db/ directory directly
      dbHandle = dirHandle
    }

    try {
      const db = new BedrockLevelDB(dbHandle)
      await db.open()
      openLevelDB(db, dirHandle.name)

      // Also open level.dat if present
      if (hasLevelDat) {
        try {
          const fh = await dirHandle.getFileHandle('level.dat')
          const file = await fh.getFile()
          const buf = await file.arrayBuffer()
          // Bedrock level.dat has a special 8-byte header before the NBT data:
          // [0-3] version (int32 LE), [4-7] NBT payload size (int32 LE)
          let nbtPayload: ArrayBuffer
          let bedrockHeader: Uint8Array | undefined
          if (buf.byteLength > 8) {
            bedrockHeader = new Uint8Array(buf.slice(0, 8))
            nbtPayload = buf.slice(8)
          } else {
            nbtPayload = buf
          }
          const doc = await parseNbt(nbtPayload, { kind: 'file', handle: fh, bedrockHeader })
          openNbtFile(doc, 'level.dat')
        } catch (e) {
          console.warn('Could not parse level.dat:', e)
        }
      }
    } catch (e) {
      console.error('Failed to open world:', e)
      alert(`Failed to open world: ${e}`)
    }
  }, [openNbtFile, openLevelDB])

  /** Save an NBT document back to its original source (file or LevelDB key) */
  const saveNbtFile = useCallback(async (doc: NbtDocument, db?: BedrockLevelDB) => {
    const bytes = serializeNbt(doc)

    if (doc.source.kind === 'leveldb' && db) {
      db.put(doc.source.key, bytes)
      await db.flush()
      markClean()
      return
    }

    if (doc.source.kind === 'file') {
      const handle = doc.source.handle
      const writable = await handle.createWritable()
      if (doc.source.bedrockHeader) {
        // Re-write the 8-byte Bedrock header, updating the payload size field
        const header = new Uint8Array(8)
        header.set(doc.source.bedrockHeader.slice(0, 4)) // preserve version bytes
        const view = new DataView(header.buffer)
        view.setInt32(4, bytes.byteLength, true) // update size (LE int32)
        await writable.write(header.buffer)
      }
      await writable.write((bytes.buffer as ArrayBuffer).slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
      await writable.close()
      markClean()
    }
  }, [markClean])

  /** Save As — pick a new file location */
  const saveNbtFileAs = useCallback(async (doc: NbtDocument, suggestedName?: string) => {
    if (!window.showSaveFilePicker) {
      // Fallback: download
      const out = serializeNbt(doc)
      const blob = new Blob([(out.buffer as ArrayBuffer).slice(out.byteOffset, out.byteOffset + out.byteLength)], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = suggestedName ?? 'output.dat'
      a.click()
      URL.revokeObjectURL(url)
      markClean()
      return
    }
    let handle: FileSystemFileHandle
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: suggestedName ?? 'output.dat',
        types: [{ description: 'NBT file', accept: { 'application/octet-stream': ['.dat', '.nbt'] } }],
      })
    } catch {
      return
    }
    const writable2 = await handle.createWritable()
    const out2 = serializeNbt(doc)
    await writable2.write((out2.buffer as ArrayBuffer).slice(out2.byteOffset, out2.byteOffset + out2.byteLength))
    await writable2.close()
    markClean()
  }, [markClean])

  /** Flush pending LevelDB writes */
  const saveLevelDB = useCallback(async (db: BedrockLevelDB) => {
    await db.flush()
    markClean()
  }, [markClean])

  return { openNbtFiles, openWorldFolder, saveNbtFile, saveNbtFileAs, saveLevelDB }
}
