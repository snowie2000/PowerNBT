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

  /** True while a world folder is being opened / read */
  isLoading: boolean
  setIsLoading: (v: boolean) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Find a node by key path. Returns [node, parent, indexInParent] */
function findNode(root: NbtNode, targetKey: string): [NbtNode, NbtNode | null, number] | null {
  function walk(node: NbtNode, parent: NbtNode | null, idx: number): [NbtNode, NbtNode | null, number] | null {
    if (node.key === targetKey) return [node, parent, idx]
    for (let i = 0; i < (node.children?.length ?? 0); i++) {
      const found = walk(node.children![i], node, i)
      if (found) return found
    }
    return null
  }
  return walk(root, null, 0)
}

function cloneNode(node: NbtNode): NbtNode {
  return {
    ...node,
    children: node.children?.map(cloneNode),
  }
}

function mutateNbtDoc(doc: NbtDocument, mutate: (root: NbtNode) => NbtNode): NbtDocument {
  return { ...doc, root: mutate(cloneNode(doc.root)) }
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
      const newDoc = mutateNbtDoc(file.doc, (root) => {
        const result = findNode(root, nodeKey)
        if (result) result[0].value = newValue
        return root
      })
      const openFiles = [...s.openFiles]
      openFiles[fileIndex] = { ...file, doc: newDoc }
      return { openFiles, dirty: true }
    })
  },

  updateNodeName(fileIndex, nodeKey, newName) {
    set((s) => {
      const file = s.openFiles[fileIndex]
      if (!file || file.kind !== 'nbt') return s
      const newDoc = mutateNbtDoc(file.doc, (root) => {
        const result = findNode(root, nodeKey)
        if (result) result[0].name = newName
        return root
      })
      const openFiles = [...s.openFiles]
      openFiles[fileIndex] = { ...file, doc: newDoc }
      return { openFiles, dirty: true }
    })
  },

  deleteNode(fileIndex, nodeKey) {
    set((s) => {
      const file = s.openFiles[fileIndex]
      if (!file || file.kind !== 'nbt') return s
      const newDoc = mutateNbtDoc(file.doc, (root) => {
        const result = findNode(root, nodeKey)
        if (result) {
          const [, parent, idx] = result
          if (parent?.children) parent.children.splice(idx, 1)
        }
        return root
      })
      const openFiles = [...s.openFiles]
      openFiles[fileIndex] = { ...file, doc: newDoc }
      return { openFiles, dirty: true, selectedKey: null }
    })
  },

  addNode(fileIndex, parentKey, node) {
    set((s) => {
      const file = s.openFiles[fileIndex]
      if (!file || file.kind !== 'nbt') return s
      const newDoc = mutateNbtDoc(file.doc, (root) => {
        const result = findNode(root, parentKey)
        if (result) {
          const [parent] = result
          if (!parent.children) parent.children = []
          parent.children.push(node)
        }
        return root
      })
      const openFiles = [...s.openFiles]
      openFiles[fileIndex] = { ...file, doc: newDoc }
      return { openFiles, dirty: true }
    })
  },

  markClean() { set({ dirty: false }) },
  markDirty() { set({ dirty: true }) },
  setIsLoading(v) { set({ isLoading: v }) },
}))
