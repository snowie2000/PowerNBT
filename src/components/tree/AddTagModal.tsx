import React, { useState } from 'react'
import { Modal, Form, Select, Input } from 'antd'
import { TAG, TAG_NAMES, type TagId, type NbtNode } from '../../lib/nbt/types'
import { useEditorStore } from '../../store/useEditorStore'

interface AddTagModalProps {
  fileIndex: number
  parentKey: string
  onClose: () => void
}

const TAG_OPTIONS = Object.entries(TAG_NAMES)
  .filter(([id]) => Number(id) !== TAG.End)
  .map(([id, name]) => ({ value: Number(id) as TagId, label: name }))

function defaultValue(type: TagId): NbtNode['value'] {
  switch (type) {
    case TAG.Byte: case TAG.Short: case TAG.Int: case TAG.Float: case TAG.Double: return 0
    case TAG.Long: return 0n
    case TAG.String: return ''
    case TAG.ByteArray: return new Int8Array(0)
    case TAG.IntArray: return new Int32Array(0)
    case TAG.LongArray: return new BigInt64Array(0)
    default: return null
  }
}

export const AddTagModal: React.FC<AddTagModalProps> = ({ fileIndex, parentKey, onClose }) => {
  const [form] = Form.useForm()
  const { addNode } = useEditorStore()
  const [loading, setLoading] = useState(false)

  const handleOk = async () => {
    setLoading(true)
    try {
      const values = await form.validateFields()
      const type = values.type as TagId
      const node: NbtNode = {
        key: `${parentKey}__new__${Date.now()}`,
        type,
        name: values.name ?? '',
        value: defaultValue(type),
        children: type === TAG.Compound || type === TAG.List ? [] : undefined,
        listType: type === TAG.List ? TAG.End : undefined,
      }
      addNode(fileIndex, parentKey, node)
      onClose()
    } catch {
      // validation failed
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      title="Add New Tag"
      open
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      destroyOnClose
    >
      <Form form={form} layout="vertical" initialValues={{ type: TAG.String }}>
        <Form.Item label="Tag Type" name="type" rules={[{ required: true }]}>
          <Select options={TAG_OPTIONS.map((o) => ({ ...o, label: TAG_NAMES[o.value] }))} />
        </Form.Item>
        <Form.Item label="Name (leave empty for List children)" name="name">
          <Input placeholder="tag_name" />
        </Form.Item>
      </Form>
    </Modal>
  )
}
