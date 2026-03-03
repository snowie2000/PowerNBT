import { create } from 'zustand'
import type { NbtDocument, NbtNode } from '../lib/nbt/types'
import type { BedrockLevelDB } from '../lib/leveldb/db'

// ── Open file descriptor ──────────────────────────────────────────────────────

export type OpenFile =
  | { kind: 'nbt'; doc: NbtDocument; name: string }
  | { kind: 'leveldb'; db: BedrockLevelDB; worldName: string }

// ── Editor state ─────────────────────────────────────────────────────────────

interface EditorState {
  /** Currently open files / databases */
  openFiles: OpenFile[]
  /** Index into openFiles */
  activeFileIndex: number

  /** Selected node key path in the tree (dots-separated) */
  selectedKey: string | null
  /** Expanded tree node keys */
  expandedKeys: string[]

  /** True when there are unsaved changes */
  dirty: boolean

  // ── Actions ──────────────────────────────────────────────────────────────

  openNbtFile: (doc: NbtDocument, name: string) => void
  openLevelDB: (db: BedrockLevelDB, worldName: string) => void
  closeFile: (index: number) => void
  setActiveFile: (index: number) => void

  selectNode: (key: string | null) => void
  setExpandedKeys: (keys: string[]) => void

  /** Update a node value by its tree key path */
  updateNodeValue: (fileIndex: number, nodeKey: string, newValue: NbtNode['value']) => void
  /** Update a node name by its tree key path */
  updateNodeName: (fileIndex: number, nodeKey: string, newName: string) => void
  /** Delete a node by its tree key path */
  deleteNode: (fileIndex: number, nodeKey: string) => void
  /** Add a child node to a compound/list */
  addNode: (fileIndex: number, parentKey: string, node: NbtNode) => void

  markClean: () => void
  markDirty: () => void

  /** Remove a leveldb entry and any nbt files from the same world path. */
  closeWorldFiles: (db: BedrockLevelDB) => void

  /** True while a world folder is being opened / read */
  isLoading: boolean
  setIsLoading: (v: boolean) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Clone only the path from root down to `targetKey`.
 * Every node NOT on that path keeps its original reference → O(depth) instead of O(n).
 */
function updatePath(
  node: NbtNode,
  targetKey: string,
  updater: (n: NbtNode) => NbtNode,
): NbtNode {
  if (node.key === targetKey) return updater(node)
  if (!node.children) return node
  let changed = false
  const newChildren = node.children.map(child => {
    const next = updatePath(child, targetKey, updater)
    if (next !== child) changed = true
    return next
  })
  if (!changed) return node
  return { ...node, children: newChildren }
}

/** Remove a child node by key, cloning only the path to its parent. */
function deletePath(node: NbtNode, targetKey: string): NbtNode {
  if (!node.children) return node
  const idx = node.children.findIndex(c => c.key === targetKey)
  if (idx !== -1) {
    return { ...node, children: node.children.filter((_, i) => i !== idx) }
  }
  let changed = false
  const newChildren = node.children.map(child => {
    const next = deletePath(child, targetKey)
    if (next !== child) changed = true
    return next
  })
  if (!changed) return node
  return { ...node, children: newChildren }
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useEditorStore = create<EditorState>((set) => ({
  openFiles: [],
  activeFileIndex: 0,
  selectedKey: null,
  expandedKeys: [],
  dirty: false,
  isLoading: false,

  openNbtFile(doc, name) {
    set((s) => ({
      openFiles: [...s.openFiles, { kind: 'nbt', doc, name }],
      activeFileIndex: s.openFiles.length,
      selectedKey: null,
      dirty: false,
    }))
  },

  openLevelDB(db, worldName) {
    set((s) => ({
      openFiles: [...s.openFiles, { kind: 'leveldb', db, worldName }],
      activeFileIndex: s.openFiles.length,
      selectedKey: null,
      dirty: false,
    }))
  },

  closeFile(index) {
    set((s) => {
      const openFiles = s.openFiles.filter((_, i) => i !== index)
      const activeFileIndex = Math.min(s.activeFileIndex, Math.max(0, openFiles.length - 1))
      return { openFiles, activeFileIndex, selectedKey: null }
    })
  },

  setActiveFile(index) {
    set({ activeFileIndex: index, selectedKey: null })
  },

  selectNode(key) {
    set({ selectedKey: key })
  },

  setExpandedKeys(expandedKeys) {
    set({ expandedKeys })
  },

  updateNodeValue(fileIndex, nodeKey, newValue) {
    set((s) => {
      const file = s.openFiles[fileIndex]
      if (!file || file.kind !== 'nbt') return s
      const newRoot = updatePath(file.doc.root, nodeKey, n => ({ ...n, value: newValue }))
      if (newRoot === file.doc.root) return s
      const openFiles = [...s.openFiles]
      openFiles[fileIndex] = { ...file, doc: { ...file.doc, root: newRoot } }
      return { openFiles, dirty: true }
    })
  },

  updateNodeName(fileIndex, nodeKey, newName) {
    set((s) => {
      const file = s.openFiles[fileIndex]
      if (!file || file.kind !== 'nbt') return s
      const newRoot = updatePath(file.doc.root, nodeKey, n => ({ ...n, name: newName }))
      if (newRoot === file.doc.root) return s
      const openFiles = [...s.openFiles]
      openFiles[fileIndex] = { ...file, doc: { ...file.doc, root: newRoot } }
      return { openFiles, dirty: true }
    })
  },

  deleteNode(fileIndex, nodeKey) {
    set((s) => {
      const file = s.openFiles[fileIndex]
      if (!file || file.kind !== 'nbt') return s
      const newRoot = deletePath(file.doc.root, nodeKey)
      if (newRoot === file.doc.root) return s
      const openFiles = [...s.openFiles]
      openFiles[fileIndex] = { ...file, doc: { ...file.doc, root: newRoot } }
      return { openFiles, dirty: true, selectedKey: null }
    })
  },

  addNode(fileIndex, parentKey, node) {
    set((s) => {
      const file = s.openFiles[fileIndex]
      if (!file || file.kind !== 'nbt') return s
      const newRoot = updatePath(file.doc.root, parentKey, parent => ({
        ...parent,
        children: [...(parent.children ?? []), node],
      }))
      if (newRoot === file.doc.root) return s
      const openFiles = [...s.openFiles]
      openFiles[fileIndex] = { ...file, doc: { ...file.doc, root: newRoot } }
      return { openFiles, dirty: true }
    })
  },

  markClean() { set({ dirty: false }) },
  markDirty() { set({ dirty: true }) },

  closeWorldFiles(db) {
    set((s) => {
      const worldRoot = db.dirPath.replace(/\/db$/, '').toLowerCase()
      const openFiles = s.openFiles.filter(f => {
        if (f.kind === 'leveldb' && f.db === db) return false
        if (f.kind === 'nbt' && f.doc.source.kind === 'file' &&
            f.doc.source.path.replace(/\\/g, '/').toLowerCase().startsWith(worldRoot)) return false
        return true
      })
      const activeFileIndex = Math.min(s.activeFileIndex, Math.max(0, openFiles.length - 1))
      return { openFiles, activeFileIndex, selectedKey: null, dirty: false }
    })
  },

  setIsLoading(v) { set({ isLoading: v }) },
}))
