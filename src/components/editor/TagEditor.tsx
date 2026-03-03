import React, { useCallback, useState, useEffect } from 'react'
import {
  Typography, Form, Input, InputNumber, Empty, Space, Tag,
} from 'antd'
import { TagIcon } from '../tree/TagIcon'
import { TAG, TAG_NAMES, type NbtNode } from '../../lib/nbt/types'
import { useEditorStore } from '../../store/useEditorStore'
import { ByteArrayEditor } from './editors/ByteArrayEditor'

const { Title, Text } = Typography

interface TagEditorProps {
  fileIndex: number
  node: NbtNode
}

export const TagEditor: React.FC<TagEditorProps> = ({ fileIndex, node }) => {
  const { updateNodeValue, updateNodeName } = useEditorStore()

  // Local state for numeric / long inputs — prevents per-keystroke store updates
  // (which clone the whole doc tree and re-render the NbtTree).
  // We sync from the node when the selected key changes, and commit on blur.
  const [localInt, setLocalInt] = useState<number | null>(null)
  const [localFloat, setLocalFloat] = useState<number | string | null>(null)
  const [localLong, setLocalLong] = useState<string>(() =>
    node.type === TAG.Long ? String(node.value as bigint) : '0'
  )
  const [localString, setLocalString] = useState<string>(() =>
    node.type === TAG.String ? (node.value as string) ?? '' : ''
  )

  // Sync local state whenever the user selects a different node
  useEffect(() => {
    setLocalInt(null)
    setLocalFloat(null)
    setLocalLong(String(node.type === TAG.Long ? (node.value as bigint) : 0n))
    setLocalString(node.type === TAG.String ? (node.value as string) ?? '' : '')
  }, [node.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleNameChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      updateNodeName(fileIndex, node.key, e.target.value)
    },
    [fileIndex, node.key, updateNodeName],
  )

  const handleValueChange = useCallback(
    (newValue: NbtNode['value']) => {
      updateNodeValue(fileIndex, node.key, newValue)
    },
    [fileIndex, node.key, updateNodeValue],
  )

  const renderValueEditor = () => {
    switch (node.type) {
      case TAG.Compound:
      case TAG.List:
        return (
          <Text type="secondary">
            Select a child node to edit its value.
          </Text>
        )

      case TAG.String:
        return (
          <Input.TextArea
            value={localString}
            autoSize={{ minRows: 2, maxRows: 10 }}
            onChange={(e) => setLocalString(e.target.value)}
            onBlur={() => handleValueChange(localString)}
          />
        )

      case TAG.Byte:
        return (
          <InputNumber
            value={localInt ?? (node.value as number)}
            min={-128}
            max={127}
            style={{ width: '100%' }}
            onChange={(v) => setLocalInt(v)}
            onBlur={() => { if (localInt != null) handleValueChange(localInt) }}
          />
        )

      case TAG.Short:
        return (
          <InputNumber
            value={localInt ?? (node.value as number)}
            min={-32768}
            max={32767}
            style={{ width: '100%' }}
            onChange={(v) => setLocalInt(v)}
            onBlur={() => { if (localInt != null) handleValueChange(localInt) }}
          />
        )

      case TAG.Int:
        return (
          <InputNumber
            value={localInt ?? (node.value as number)}
            min={-2147483648}
            max={2147483647}
            style={{ width: '100%' }}
            onChange={(v) => setLocalInt(v)}
            onBlur={() => { if (localInt != null) handleValueChange(localInt) }}
          />
        )

      case TAG.Long:
        return (
          <Input
            value={localLong}
            onChange={(e) => setLocalLong(e.target.value)}
            onBlur={() => {
              try { handleValueChange(BigInt(localLong)) } catch { /* invalid, don't commit */ }
            }}
            addonAfter="L"
          />
        )

      case TAG.Float:
        return (
          <InputNumber
            value={localFloat ?? (node.value as number)}
            step={0.001}
            stringMode
            style={{ width: '100%' }}
            onChange={(v) => setLocalFloat(v)}
            onBlur={() => {
              if (localFloat != null) {
                const n = typeof localFloat === 'string' ? parseFloat(localFloat) : localFloat
                if (!isNaN(n)) handleValueChange(n)
              }
            }}
          />
        )

      case TAG.Double:
        return (
          <InputNumber
            value={localFloat ?? (node.value as number)}
            step={0.0001}
            stringMode
            style={{ width: '100%' }}
            onChange={(v) => setLocalFloat(v)}
            onBlur={() => {
              if (localFloat != null) {
                const n = typeof localFloat === 'string' ? parseFloat(localFloat) : localFloat
                if (!isNaN(n)) handleValueChange(n)
              }
            }}
          />
        )

      case TAG.ByteArray:
        return (
          <ByteArrayEditor
            value={node.value as Int8Array}
            onChange={(v) => handleValueChange(v)}
          />
        )

      case TAG.IntArray:
        return (
          <Input.TextArea
            value={Array.from(node.value as Int32Array).join(', ')}
            autoSize={{ minRows: 3, maxRows: 8 }}
            onChange={(e) => {
              try {
                const arr = e.target.value.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n))
                handleValueChange(new Int32Array(arr))
              } catch { /* ignore */ }
            }}
          />
        )

      case TAG.LongArray:
        return (
          <Input.TextArea
            value={Array.from(node.value as BigInt64Array).map(String).join(', ')}
            autoSize={{ minRows: 3, maxRows: 8 }}
            onChange={(e) => {
              try {
                const arr = e.target.value.split(',').map((s) => BigInt(s.trim()))
                handleValueChange(new BigInt64Array(arr))
              } catch { /* ignore */ }
            }}
          />
        )

      default:
        return <Text type="secondary">No editor for this tag type.</Text>
    }
  }

  return (
    <div style={{ padding: 16, height: '100%', overflowY: 'auto' }}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        {/* Header */}
        <Space align="center">
          <TagIcon type={node.type} style={{ fontSize: 20 }} />
          <Title level={5} style={{ margin: 0 }}>
            {node.name || <Text italic type="secondary">(unnamed)</Text>}
          </Title>
          <Tag color="default" style={{ fontFamily: 'monospace', fontSize: 11 }}>
            {TAG_NAMES[node.type]}
          </Tag>
        </Space>

        {/* Name editor */}
        <Form layout="vertical" size="small">
          <Form.Item label="Key name">
            <Input
              value={node.name}
              onChange={handleNameChange}
              placeholder="tag_name"
            />
          </Form.Item>

          {/* Value editor (hidden for containers) */}
          {node.type !== TAG.Compound && node.type !== TAG.List && (
            <Form.Item label="Value">
              {renderValueEditor()}
            </Form.Item>
          )}

          {/* Container info */}
          {(node.type === TAG.Compound || node.type === TAG.List) && (
            <Form.Item>
              {renderValueEditor()}
              <Text type="secondary" style={{ fontSize: 12 }}>
                {node.type === TAG.Compound
                  ? `${node.children?.length ?? 0} children`
                  : `${node.children?.length ?? 0} elements of type ${TAG_NAMES[node.listType ?? TAG.End]}`}
              </Text>
            </Form.Item>
          )}
        </Form>
      </Space>
    </div>
  )
}

/** Wrapper shown when no node is selected */
export const EmptyTagEditor: React.FC = () => (
  <Empty
    style={{ marginTop: 80 }}
    description="Select a tag in the tree to edit it"
  />
)
