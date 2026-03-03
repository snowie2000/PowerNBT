import React, { useMemo } from 'react'
import { Input, Space, Typography } from 'antd'

const { Text } = Typography

interface ByteArrayEditorProps {
  value: Int8Array
  onChange: (v: Int8Array) => void
}

/** Renders a byte array as space-separated hex values, editable in a textarea */
export const ByteArrayEditor: React.FC<ByteArrayEditorProps> = ({ value, onChange }) => {
  const hexString = useMemo(
    () =>
      Array.from(value)
        .map((b) => (b & 0xff).toString(16).padStart(2, '0'))
        .join(' '),
    [value],
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    try {
      const tokens = e.target.value.trim().split(/\s+/)
      const bytes = tokens
        .filter((t) => t.length > 0)
        .map((t) => {
          const n = parseInt(t, 16)
          if (isNaN(n) || n < 0 || n > 255) throw new Error()
          return n >= 128 ? n - 256 : n
        })
      onChange(new Int8Array(bytes))
    } catch {
      // invalid hex – ignore
    }
  }

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      <Input.TextArea
        value={hexString}
        onChange={handleChange}
        autoSize={{ minRows: 3, maxRows: 10 }}
        style={{ fontFamily: 'monospace', fontSize: 12 }}
        placeholder="Hex bytes separated by spaces: 00 1a ff …"
      />
      <Text type="secondary" style={{ fontSize: 11 }}>{value.byteLength} byte(s)</Text>
    </Space>
  )
}
