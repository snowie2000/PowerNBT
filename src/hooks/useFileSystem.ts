import { useCallback } from 'react'
import { parseNbt, serializeNbt } from '../lib/nbt/parser'
import { BedrockLevelDB } from '../lib/leveldb/db'
import { useEditorStore } from '../store/useEditorStore'
import type { NbtDocument } from '../lib/nbt/types'

export function useFileSystem() {
  const { openNbtFile, openLevelDB, markClean, setIsLoading } = useEditorStore()

  // ── Open NBT files ──────────────────────────────────────────────────────

  const openNbtFiles = useCallback(async () => {
    const paths = await window.electronAPI.dialog.openFiles([
      { name: 'NBT Files', extensions: ['dat', 'nbt', 'mcstructure', 'dat_old'] },
    ])
    if (!paths) return

    for (const filePath of paths) {
      try {
        const bytes = await window.electronAPI.fs.readFile(filePath)
        if (!bytes) { alert(`Could not read ${filePath}`); continue }
        const doc = await parseNbt(bytes.buffer as ArrayBuffer, { kind: 'file', path: filePath })
        const name = filePath.replace(/\\/g, '/').split('/').pop() ?? filePath
        openNbtFile(doc, name)
      } catch (e) {
        alert(`Failed to read ${filePath}: ${e}`)
      }
    }
  }, [openNbtFile])

  // ── Open Bedrock world folder ────────────────────────────────────────────

  const openWorldFolder = useCallback(async () => {
    const worldPath = await window.electronAPI.dialog.openDirectory()
    if (!worldPath) return

    // Normalise separators
    const wp = worldPath.replace(/\\/g, '/')
    const dbPath = wp + '/db'

    // Open the LevelDB
    setIsLoading(true)
    try {
      const db = new BedrockLevelDB(dbPath)
      await db.open()
      const worldName = wp.split('/').pop() ?? wp
      openLevelDB(db, worldName)

      // Also open level.dat if present
      const levelDatPath = wp + '/level.dat'
      const exists = await window.electronAPI.fs.exists(levelDatPath)
      if (exists) {
        try {
          const buf = await window.electronAPI.fs.readFile(levelDatPath)
          if (!buf) throw new Error('level.dat is empty or unreadable')
          // Bedrock level.dat has an 8-byte header: 4-byte version + 4-byte payload size
          let bedrockHeader: Uint8Array | undefined
          let nbtData: ArrayBuffer
          if (buf.byteLength > 8) {
            bedrockHeader = buf.slice(0, 8)
            nbtData = buf.slice(8).buffer as ArrayBuffer
          } else {
            nbtData = buf.buffer as ArrayBuffer
          }
          const doc = await parseNbt(nbtData, { kind: 'file', path: levelDatPath, bedrockHeader })
          openNbtFile(doc, 'level.dat')
        } catch (e) {
          console.warn('Could not parse level.dat:', e)
        }
      }
    } catch (e) {
      alert(`Failed to open world: ${e}`)
    } finally {
      setIsLoading(false)
    }
  }, [openNbtFile, openLevelDB, setIsLoading])

  // ── Save ─────────────────────────────────────────────────────────────────

  /**
   * Save an NBT document back to its source.
   * For file sources writes directly to the path.
   * For leveldb sources calls db.put() + db.flush().
   */
  const saveNbtFile = useCallback(async (doc: NbtDocument, db?: BedrockLevelDB) => {
    const bytes = serializeNbt(doc)

    if (doc.source.kind === 'leveldb' && db) {
      db.put(doc.source.key, bytes)
      await db.flush()
      markClean()
      return
    }

    if (doc.source.kind === 'file') {
      let data: Uint8Array
      if (doc.source.bedrockHeader) {
        // Re-write the 8-byte Bedrock header with updated payload size
        const header = new Uint8Array(8)
        header.set(doc.source.bedrockHeader.slice(0, 4)) // keep version bytes
        new DataView(header.buffer).setInt32(4, bytes.byteLength, true) // update size LE
        data = new Uint8Array(8 + bytes.byteLength)
        data.set(header)
        data.set(bytes, 8)
      } else {
        data = bytes
      }
      await window.electronAPI.fs.writeFile(doc.source.path, data)
      markClean()
      return
    }

    // Fallback: shouldn't happen
    await saveNbtFileAs(doc, 'output.dat')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markClean])

  /** Save-As: prompt for a new file path, then write. */
  const saveNbtFileAs = useCallback(async (doc: NbtDocument, suggestedName?: string) => {
    const bytes = serializeNbt(doc)
    const name  = suggestedName ?? 'output.dat'
    const savePath = await window.electronAPI.dialog.saveFile(name)
    if (!savePath) return
    await window.electronAPI.fs.writeFile(savePath, bytes)
    markClean()
  }, [markClean])

  /** Flush pending LevelDB writes. */
  const saveLevelDB = useCallback(async (db: BedrockLevelDB) => {
    await db.flush()
    markClean()
  }, [markClean])

  return { openNbtFiles, openWorldFolder, saveNbtFile, saveNbtFileAs, saveLevelDB }
}
