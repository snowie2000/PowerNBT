import React from 'react'
import { Button, Space, Tooltip, Badge, Typography, Popconfirm } from 'antd'
import {
  FolderOpenOutlined,
  DatabaseOutlined,
  SaveOutlined,
  SaveFilled,
  CloseCircleOutlined,
} from '@ant-design/icons'
import { useEditorStore } from '../../store/useEditorStore'
import { useFileSystem } from '../../hooks/useFileSystem'
import type { OpenFile } from '../../store/useEditorStore'

const { Text } = Typography

export const Toolbar: React.FC = () => {
  const { openFiles, activeFileIndex, dirty } = useEditorStore()
  const { openNbtFiles, openWorldFolder, closeWorldFolder, saveNbtFile, saveNbtFileAs, saveLevelDB } = useFileSystem()

  const activeFile: OpenFile | undefined = openFiles[activeFileIndex]
  const openWorld = openFiles.find(f => f.kind === 'leveldb')

  const handleSave = async () => {
    if (!activeFile) return
    try {
      if (activeFile.kind === 'nbt') {
        if (activeFile.doc.source.kind === 'file') {
          await saveNbtFile(activeFile.doc)
        } else if (activeFile.doc.source.kind === 'leveldb') {
          // Find the open DB instance by dirPath (worldPath is now db.dirPath)
          const worldPath = activeFile.doc.source.worldPath
          const lvlFile = openFiles.find((f) => f.kind === 'leveldb' && f.db.dirPath === worldPath)
          const db = lvlFile?.kind === 'leveldb' ? lvlFile.db : undefined
          if (db) {
            await saveNbtFile(activeFile.doc, db)
          } else {
            await saveNbtFileAs(activeFile.doc, activeFile.name)
          }
        } else {
          await saveNbtFileAs(activeFile.doc, activeFile.name)
        }
      } else if (activeFile.kind === 'leveldb') {
        await saveLevelDB(activeFile.db)
      }
    } catch (e) {
      alert(`An error occurred: ${e}`)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        height: 48,
        borderBottom: '1px solid #f0f0f0',
        background: '#fff',
        gap: 8,
      }}
    >
      {/* Brand */}
      <Space align="center">
        <DatabaseOutlined style={{ fontSize: 20, color: '#1677ff' }} />
        <Text strong style={{ fontSize: 16 }}>
          Power<span style={{ color: '#1677ff' }}>NBT</span>
        </Text>
      </Space>

      {/* Actions */}
      <Space>
        <Tooltip title="Open NBT file (.dat, .nbt, .mcstructure)">
          <Button icon={<FolderOpenOutlined />} onClick={openNbtFiles}>
            Open File
          </Button>
        </Tooltip>

        <Tooltip title="Open Minecraft Bedrock world folder">
          <Button icon={<DatabaseOutlined />} onClick={openWorldFolder} type="default">
            Open World
          </Button>
        </Tooltip>

        {openWorld && openWorld.kind === 'leveldb' && (
          <Popconfirm
            title="Close world?"
            description={dirty ? 'You have unsaved changes — they will be lost.' : `Close "${openWorld.worldName}"?`}
            onConfirm={() => closeWorldFolder(openWorld.db, true)}
            okText="Close"
            cancelText="Cancel"
            okButtonProps={{ danger: true }}
          >
            <Tooltip title={`Close ${openWorld.worldName}`}>
              <Button icon={<CloseCircleOutlined />} danger>
                Close World
              </Button>
            </Tooltip>
          </Popconfirm>
        )}

        <Tooltip title={dirty ? 'Save (Ctrl+S)' : 'No unsaved changes'}>
          <Badge dot={dirty} offset={[-2, 2]}>
            <Button
              icon={dirty ? <SaveFilled /> : <SaveOutlined />}
              type={dirty ? 'primary' : 'default'}
              onClick={handleSave}
              disabled={!activeFile}
            >
              Save
            </Button>
          </Badge>
        </Tooltip>
      </Space>

      {/* Right side */}
      <Space>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Minecraft Bedrock NBT Editor
        </Text>
      </Space>
    </div>
  )
}
