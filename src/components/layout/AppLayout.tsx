import React, { useMemo, useState, useRef, useCallback } from 'react'
import { Layout, Tabs, Button, Typography, Space, Spin } from 'antd'
import { CloseOutlined, FolderOpenOutlined, DatabaseOutlined } from '@ant-design/icons'
import { Toolbar } from '../toolbar/Toolbar'
import { NbtTree } from '../tree/NbtTree'
import { TagEditor, EmptyTagEditor } from '../editor/TagEditor'
import { LevelDBViewer } from '../leveldb/LevelDBViewer'
import { useEditorStore } from '../../store/useEditorStore'
import { useFileSystem } from '../../hooks/useFileSystem'
import type { NbtNode } from '../../lib/nbt/types'

const { Text } = Typography

const MIN_SIDER = 200
const MAX_SIDER = 800
const DEFAULT_SIDER = 360

export const AppLayout: React.FC = () => {
  const { openFiles, activeFileIndex, selectedKey, closeFile, setActiveFile, isLoading } = useEditorStore()
  const { openNbtFiles, openWorldFolder } = useFileSystem()

  const [siderWidth, setSiderWidth] = useState(DEFAULT_SIDER)
  const siderRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartW = useRef(0)

  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    dragStartX.current = e.clientX
    dragStartW.current = siderWidth

    const onMouseMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = ev.clientX - dragStartX.current
      const next = Math.min(MAX_SIDER, Math.max(MIN_SIDER, dragStartW.current + delta))
      // Mutate DOM directly — no React re-render during drag
      if (siderRef.current) {
        siderRef.current.style.width = `${next}px`
        siderRef.current.style.minWidth = `${next}px`
        siderRef.current.style.maxWidth = `${next}px`
      }
      dragStartW.current = next
      dragStartX.current = ev.clientX
    }
    const onMouseUp = () => {
      dragging.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      // Sync React state once at the end
      if (siderRef.current) {
        setSiderWidth(parseInt(siderRef.current.style.width, 10))
      }
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [siderWidth])

  const activeFile = openFiles[activeFileIndex]

  const selectedNode = useMemo(() => {
    if (!selectedKey || !activeFile || activeFile.kind !== 'nbt') return null
    function find(node: NbtNode): NbtNode | null {
      if (node.key === selectedKey) return node
      for (const c of node.children ?? []) {
        const r = find(c)
        if (r) return r
      }
      return null
    }
    return find(activeFile.doc.root)
  }, [selectedKey, activeFile])

  const tabItems = openFiles.map((f: (typeof openFiles)[number], i: number) => ({
    key: String(i),
    label: (
      <span>
        {f.kind === 'nbt' ? f.name : `🌍 ${f.worldName}`}
        <CloseOutlined
          style={{ marginLeft: 8, fontSize: 10, opacity: 0.5 }}
          onClick={(e) => { e.stopPropagation(); closeFile(i) }}
        />
      </span>
    ),
  }))

  return (
    <Layout style={{ height: '100vh', overflow: 'hidden' }}>
      {isLoading && <Spin spinning fullscreen tip="Opening world…" size="large" />}
      <Toolbar />

      {openFiles.length === 0 ? (
        <WelcomeScreen onOpenFile={openNbtFiles} onOpenWorld={openWorldFolder} />
      ) : (
        <>
          <Tabs
            size="small"
            items={tabItems}
            activeKey={String(activeFileIndex)}
            onChange={(k) => setActiveFile(Number(k))}
            style={{ background: '#fff', padding: '0 4px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}
            tabBarStyle={{ margin: 0 }}
          />
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>
          {/* Left panel */}
          <div
            ref={siderRef}
            style={{
              width: siderWidth,
              minWidth: siderWidth,
              maxWidth: siderWidth,
              background: '#fff',
              overflow: 'hidden',
            }}
          >
            {activeFile?.kind === 'nbt' && (
              <NbtTree fileIndex={activeFileIndex} root={activeFile.doc.root} />
            )}
            {activeFile?.kind === 'leveldb' && (
              <LevelDBViewer db={activeFile.db} worldName={activeFile.worldName} />
            )}
          </div>

          {/* Drag divider */}
          <div
            onMouseDown={onDividerMouseDown}
            style={{
              width: 5,
              cursor: 'col-resize',
              background: 'transparent',
              borderLeft: '1px solid #f0f0f0',
              flexShrink: 0,
              position: 'relative',
              zIndex: 10,
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = '#e6f0ff' }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
          />

          {/* Right panel */}
          <div
            style={{
              flex: 1,
              background: '#fafafa',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
            }}
          >
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {selectedNode && activeFile?.kind === 'nbt' ? (
                <TagEditor fileIndex={activeFileIndex} node={selectedNode} />
              ) : (
                <EmptyTagEditor />
              )}
            </div>
          </div>
          </div>
        </>
      )}
    </Layout>
  )
}

interface WelcomeScreenProps {
  onOpenFile: () => void
  onOpenWorld: () => void
}

const WelcomeScreen: React.FC<WelcomeScreenProps> = ({ onOpenFile, onOpenWorld }) => (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fafafa' }}>
    <Space direction="vertical" align="center" size="large">
      <DatabaseOutlined style={{ fontSize: 64, color: '#1677ff', opacity: 0.4 }} />
      <Text type="secondary" style={{ fontSize: 16 }}>
        Open a file or Minecraft Bedrock world to get started
      </Text>
      <Space>
        <Button size="large" icon={<FolderOpenOutlined />} onClick={onOpenFile}>
          Open NBT File
        </Button>
        <Button size="large" icon={<DatabaseOutlined />} type="primary" onClick={onOpenWorld}>
          Open World Folder
        </Button>
      </Space>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Supports .dat · .nbt · .mcstructure · Bedrock LevelDB worlds
      </Text>
    </Space>
  </div>
)
