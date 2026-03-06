import React, { useMemo, useCallback, useState, useRef } from 'react'
import { Input, Dropdown, type MenuProps } from 'antd'
import { SearchOutlined, PlusOutlined, DeleteOutlined, CaretRightFilled, CaretDownFilled } from '@ant-design/icons'
import { useVirtualizer } from '@tanstack/react-virtual'
import { TagIcon } from './TagIcon'
import { TAG, TAG_NAMES, type NbtNode, type TagId } from '../../lib/nbt/types'
import { useEditorStore } from '../../store/useEditorStore'
import { AddTagModal } from './AddTagModal'

interface NbtTreeProps {
  fileIndex: number
  root: NbtNode
}

//  Flat tree model 

interface FlatNode {
  node: NbtNode
  depth: number
  isExpanded: boolean
}

function flattenVisible(root: NbtNode, expandedKeys: ReadonlySet<string>): FlatNode[] {
  const result: FlatNode[] = []
  function walk(node: NbtNode, depth: number) {
    const isExpanded = expandedKeys.has(node.key)
    result.push({ node, depth, isExpanded })
    if (node.children && node.children.length > 0 && isExpanded) {
      for (const child of node.children) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return result
}

//  Search filter 

function filterTree(node: NbtNode, query: string): NbtNode | null {
  const q = query.toLowerCase()
  const nameMatch = node.name.toLowerCase().includes(q)
  const valueMatch = node.value != null && String(node.value).toLowerCase().includes(q)
  if (node.children) {
    const filtered = node.children.flatMap((c) => { const r = filterTree(c, q); return r ? [r] : [] })
    if (nameMatch || filtered.length > 0) return { ...node, children: filtered }
    return null
  }
  return nameMatch || valueMatch ? node : null
}

//  Label helpers 

function getTypeLabel(node: NbtNode): string {
  if (node.type === TAG.Compound)
    return `${TAG_NAMES[node.type]}  ${node.children?.length ?? 0}`
  if (node.type === TAG.List)
    return `${TAG_NAMES[node.type]}<${TAG_NAMES[node.listType ?? TAG.End]}>  ${node.children?.length ?? 0}`
  return TAG_NAMES[node.type]
}

function formatValue(type: TagId, value: NbtNode['value']): string {
  if (value === null) return ''
  if (type === TAG.ByteArray) return `[${(value as Int8Array).byteLength} bytes]`
  if (type === TAG.IntArray) return `[${(value as Int32Array).byteLength / 4} ints]`
  if (type === TAG.LongArray) return `[${(value as BigInt64Array).byteLength / 8} longs]`
  if (type === TAG.Long) return String(value as bigint)
  if (type === TAG.Float || type === TAG.Double) return (value as number).toPrecision(7)
  return String(value)
}

//  Tree item heights 

const INDENT = 18        // px per depth level
const HEIGHT_SINGLE = 28 // nodes without a value row
const HEIGHT_DOUBLE = 44 // nodes with a value row

function itemHeight(node: NbtNode): number {
  const hasValue = node.type !== TAG.Compound && node.type !== TAG.List && node.value != null
  return hasValue ? HEIGHT_DOUBLE : HEIGHT_SINGLE
}

//  Component 

const NbtTreeInner: React.FC<NbtTreeProps> = ({ fileIndex, root }) => {
  const { selectedKey, selectNode, deleteNode } = useEditorStore()
  const [search, setSearch] = useState('')
  const [addModalParentKey, setAddModalParentKey] = useState<string | null>(null)
  const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set<string>())
  const containerRef = useRef<HTMLDivElement>(null)

  // Keep a ref so virtualizer callbacks (estimateSize, getItemKey) are always
  // current without needing to re-create the virtualizer on every render.
  const flatNodesRef = useRef<FlatNode[]>([])

  const displayRoot = useMemo(() => {
    if (!search.trim()) return root
    return filterTree(root, search) ?? { ...root, children: [] }
  }, [root, search])

  const flatNodes = useMemo(
    () => flattenVisible(displayRoot, expandedKeys),
    [displayRoot, expandedKeys],
  )
  flatNodesRef.current = flatNodes

  const virtualizer = useVirtualizer({
    count: flatNodes.length,
    getScrollElement: () => containerRef.current,
    // Stable callbacks via ref  virtualizer never forces a re-render on its own
    estimateSize: useCallback((i: number) => {
      const fn = flatNodesRef.current[i]
      return fn ? itemHeight(fn.node) : HEIGHT_SINGLE
    }, []),
    getItemKey: useCallback(
      (i: number) => flatNodesRef.current[i]?.node.key ?? String(i),
      [],
    ),
    overscan: 10,
  })

  const toggleExpand = useCallback((key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  const contextMenuFor = useCallback(
    (nodeKey: string, nodeType: TagId): MenuProps['items'] => [
      {
        key: 'add',
        icon: <PlusOutlined />,
        label: 'Add child tag',
        disabled: nodeType !== TAG.Compound && nodeType !== TAG.List,
        onClick: () => setAddModalParentKey(nodeKey),
      },
      { type: 'divider' },
      {
        key: 'delete',
        icon: <DeleteOutlined />,
        label: 'Delete',
        danger: true,
        onClick: () => deleteNode(fileIndex, nodeKey),
      },
    ],
    [fileIndex, deleteNode],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <Input
        size="small"
        placeholder="Search keys / values"
        prefix={<SearchOutlined />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ margin: '8px 8px 4px', width: 'calc(100% - 16px)' }}
      />

      {/* Scroll container  we own scrollTop, nothing else touches it */}
      <div
        ref={containerRef}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vRow) => {
            const { node, depth, isExpanded } = flatNodes[vRow.index]
            const hasChildren = !!node.children && node.children.length > 0
            const hasValue = node.type !== TAG.Compound && node.type !== TAG.List && node.value != null
            const isSelected = selectedKey === node.key

            return (
              <Dropdown
                key={node.key}
                menu={{ items: contextMenuFor(node.key, node.type) }}
                trigger={['contextMenu']}
              >
                <div
                  style={{
                    position: 'absolute',
                    top: vRow.start,
                    left: 0,
                    right: 0,
                    height: vRow.size,
                    display: 'flex',
                    alignItems: 'center',
                    paddingLeft: depth * INDENT + 4,
                    paddingRight: 8,
                    background: isSelected ? '#e6f4ff' : 'transparent',
                    cursor: 'pointer',
                    userSelect: 'none',
                    boxSizing: 'border-box',
                  }}
                  onClick={() => selectNode(node.key)}
                >
                  {/* Expand / collapse caret */}
                  <span
                    style={{
                      width: 16,
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      opacity: hasChildren ? 0.45 : 0,
                    }}
                    onClick={(e) => { if (hasChildren) toggleExpand(node.key, e) }}
                  >
                    {isExpanded ? <CaretDownFilled /> : <CaretRightFilled />}
                  </span>

                  <TagIcon type={node.type} style={{ flexShrink: 0 }} />

                  <div style={{ flex: 1, minWidth: 0, marginLeft: 5, lineHeight: '1.3', overflow: 'hidden' }}>
                    {/* Row 1: name + type badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
                      <span style={{
                        flex: '1 1 0',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 13,
                        fontWeight: 600,
                      }}>
                        {node.name || (
                          <span style={{ fontWeight: 400, fontStyle: 'italic', opacity: 0.5 }}>
                            (unnamed)
                          </span>
                        )}
                      </span>
                      <span style={{
                        flexShrink: 0,
                        fontSize: 10,
                        opacity: 0.55,
                        fontFamily: 'monospace',
                        whiteSpace: 'nowrap',
                      }}>
                        {getTypeLabel(node)}
                      </span>
                    </div>

                    {/* Row 2: value (leaf nodes only) */}
                    {hasValue && (
                      <div style={{
                        fontSize: 11,
                        fontFamily: 'monospace',
                        opacity: 0.6,
                        color: 'rgba(0,0,0,0.45)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                        {formatValue(node.type, node.value)}
                      </div>
                    )}
                  </div>
                </div>
              </Dropdown>
            )
          })}
        </div>
      </div>

      {addModalParentKey && (
        <AddTagModal
          fileIndex={fileIndex}
          parentKey={addModalParentKey}
          onClose={() => setAddModalParentKey(null)}
        />
      )}
    </div>
  )
}

export const NbtTree = React.memo(NbtTreeInner)
