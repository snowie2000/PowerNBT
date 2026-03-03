import React, { useMemo, useCallback, useState } from 'react'
import { Tree, Input, Dropdown, type MenuProps } from 'antd'
import { SearchOutlined, PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import type { DataNode } from 'antd/es/tree'
import { TagIcon } from './TagIcon'
import { TAG, TAG_NAMES, type NbtNode, type TagId } from '../../lib/nbt/types'
import { useEditorStore } from '../../store/useEditorStore'
import { AddTagModal } from './AddTagModal'

interface NbtTreeProps {
  fileIndex: number
  root: NbtNode
}

/** Convert our NbtNode tree into Ant Design DataNode tree */
function toDataNodes(node: NbtNode): DataNode {
  const isLeaf = !node.children || node.children.length === 0
  const hasValue = node.type !== TAG.Compound && node.type !== TAG.List && node.value != null

  const typeLabel =
    node.type === TAG.Compound
      ? `${TAG_NAMES[node.type]} · ${node.children?.length ?? 0}`
      : node.type === TAG.List
        ? `${TAG_NAMES[node.type]}<${TAG_NAMES[node.listType ?? TAG.End]}> · ${node.children?.length ?? 0}`
        : TAG_NAMES[node.type]

  const titleContent = (
    <div style={{ lineHeight: '1.3', padding: '1px 0', minWidth: 0 }}>
      {/* Row 1: icon + name + type badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0 }}>
        <TagIcon type={node.type} style={{ flexShrink: 0 }} />
        <span
          style={{
            flex: '1 1 0',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {node.name || <span style={{ fontWeight: 400, fontStyle: 'italic', opacity: 0.5 }}>(unnamed)</span>}
        </span>
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            opacity: 0.55,
            fontFamily: 'monospace',
            whiteSpace: 'nowrap',
          }}
        >
          {typeLabel}
        </span>
      </div>

      {/* Row 2: value (only for leaf nodes with a value) */}
      {hasValue && (
        <div style={{ paddingLeft: 19, marginTop: 0 }}>
          <span
            style={{
              fontSize: 11,
              fontFamily: 'monospace',
              display: 'block',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              opacity: 0.6,
              color: 'rgba(0,0,0,0.45)',
            }}
          >
            {formatValue(node.type, node.value)}
          </span>
        </div>
      )}
    </div>
  )

  return {
    key: node.key,
    title: titleContent,
    isLeaf,
    children: node.children?.map(toDataNodes),
    icon: null, // icon is embedded in titleContent above
  }
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

function filterTree(node: NbtNode, query: string): NbtNode | null {
  const q = query.toLowerCase()
  const nameMatch = node.name.toLowerCase().includes(q)
  const valueMatch = node.value != null && String(node.value).toLowerCase().includes(q)

  if (node.children) {
    const filtered = node.children.flatMap((c) => {
      const r = filterTree(c, q)
      return r ? [r] : []
    })
    if (nameMatch || filtered.length > 0) {
      return { ...node, children: filtered }
    }
    return null
  }

  return nameMatch || valueMatch ? node : null
}

const NbtTreeInner: React.FC<NbtTreeProps> = ({ fileIndex, root }) => {
  const { selectedKey, expandedKeys, selectNode, setExpandedKeys, deleteNode } = useEditorStore()
  const [search, setSearch] = useState('')
  const [addModalParentKey, setAddModalParentKey] = useState<string | null>(null)

  const displayRoot = useMemo(() => {
    if (!search.trim()) return root
    return filterTree(root, search) ?? root
  }, [root, search])

  // Pre-build key→type map to avoid O(n) traversal per rendered node
  const nodeTypeMap = useMemo(() => {
    const map = new Map<string, TagId>()
    function walk(n: NbtNode) {
      map.set(n.key, n.type)
      n.children?.forEach(walk)
    }
    walk(displayRoot)
    return map
  }, [displayRoot])

  const treeData = useMemo(() => [toDataNodes(displayRoot)], [displayRoot])

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

  const titleRender = useCallback((node: { key: React.Key; title?: React.ReactNode }) => {
    const key = node.key as string
    const type = nodeTypeMap.get(key) ?? TAG.End
    return (
      <Dropdown
        menu={{ items: contextMenuFor(key, type) }}
        trigger={['contextMenu']}
      >
        <div style={{ width: '100%', minWidth: 0 }}>
          {node.title as React.ReactNode}
        </div>
      </Dropdown>
    )
  }, [nodeTypeMap, contextMenuFor])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Input
        size="small"
        placeholder="Search keys / values…"
        prefix={<SearchOutlined />}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        allowClear
        style={{ margin: '8px 8px 4px' }}
      />

      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        <Tree
          showLine={{ showLeafIcon: false }}
          blockNode
          treeData={treeData as unknown as { key: string }[]}
          selectedKeys={selectedKey ? [selectedKey] : []}
          expandedKeys={expandedKeys}
          onSelect={(keys) => selectNode((keys[0] as string) ?? null)}
          onExpand={(keys) => setExpandedKeys(keys as string[])}
          titleRender={titleRender}
        />
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
