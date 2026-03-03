import React from 'react'
import {
  NumberOutlined,
  FontSizeOutlined,
  FolderOutlined,
  UnorderedListOutlined,
  CodeOutlined,
  FieldBinaryOutlined,
} from '@ant-design/icons'
import { TAG, type TagId } from '../../lib/nbt/types'

interface TagIconProps {
  type: TagId
  style?: React.CSSProperties
}

const COLOR_MAP: Record<TagId, string> = {
  [TAG.End]: '#888',
  [TAG.Byte]: '#e67e22',
  [TAG.Short]: '#f39c12',
  [TAG.Int]: '#2980b9',
  [TAG.Long]: '#8e44ad',
  [TAG.Float]: '#27ae60',
  [TAG.Double]: '#16a085',
  [TAG.ByteArray]: '#e74c3c',
  [TAG.String]: '#c0392b',
  [TAG.List]: '#d35400',
  [TAG.Compound]: '#2c3e50',
  [TAG.IntArray]: '#2471a3',
  [TAG.LongArray]: '#6c3483',
}

export const TagIcon: React.FC<TagIconProps> = ({ type, style }) => {
  const color = COLOR_MAP[type] ?? '#888'
  const merged: React.CSSProperties = { color, fontSize: 14, ...style }

  switch (type) {
    case TAG.Compound:
      return <FolderOutlined style={merged} />
    case TAG.List:
      return <UnorderedListOutlined style={merged} />
    case TAG.String:
      return <FontSizeOutlined style={merged} />
    case TAG.Byte:
    case TAG.Short:
    case TAG.Int:
    case TAG.Long:
    case TAG.Float:
    case TAG.Double:
      return <NumberOutlined style={merged} />
    case TAG.ByteArray:
    case TAG.IntArray:
    case TAG.LongArray:
      return <FieldBinaryOutlined style={merged} />
    default:
      return <CodeOutlined style={merged} />
  }
}
