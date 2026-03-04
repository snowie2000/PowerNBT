import React, { useMemo, useState } from 'react'
import { List, Input, Typography, Tag, App } from 'antd'
import { SearchOutlined, DatabaseOutlined, CodeOutlined, LoadingOutlined } from '@ant-design/icons'
import type { BedrockLevelDB } from '../../lib/leveldb/db'
import { describeKey } from '../../lib/leveldb/minecraft'
import { parseNbt } from '../../lib/nbt/parser'
import { useEditorStore } from '../../store/useEditorStore'

const { Text } = Typography

interface LevelDBViewerProps {
  db: BedrockLevelDB
  worldName: string
}

interface KeyEntry {
  key: Uint8Array
  label: string
  category: string
}

function categorise(label: string): { cat: string; color: string } {
  // Chunk data (binary keys decoded as chunk coordinates)
  if (label.startsWith('SubChunk') || label.startsWith('Chunk')) return { cat: 'Chunk', color: 'blue' }
  // Actor binary keys
  if (label.startsWith('actorprefix') || label.startsWith('digp')) return { cat: 'Actor', color: 'volcano' }
  // Player — local + remote (player_<numericId> or player_server_<UUID>)
  if (label === '~local_player' || label.startsWith('player_')) return { cat: 'Player', color: 'green' }
  // Maps
  if (label.startsWith('map_')) return { cat: 'Map', color: 'gold' }
  // Villages
  if (label.startsWith('VILLAGE_') || label.startsWith('village')) return { cat: 'Village', color: 'purple' }
  // Scoreboard
  if (label === 'scoreboard') return { cat: 'Score', color: 'orange' }
  // World-global data
  if (
    label === 'leveldata' || label === 'AutonomousEntities' ||
    label === 'Overworld' || label === 'Nether' || label === 'TheEnd' ||
    label === 'portals' || label === 'BiomeData' || label === 'mobevents' ||
    label === 'schedulerWT' || label === 'LevelChunkMetaDataDictionary' ||
    label === 'game_flatworldlayers' || label.startsWith('tickingarea') ||
    label.startsWith('structuretemplate') || label.startsWith('DynamicProperties') ||
    label.startsWith('SST_') || label.startsWith('RealmsStoriesData_') ||
    label === 'DedicatedServerForcedCorruption'
  ) return { cat: 'World', color: 'red' }
  // Raw binary we couldn't decode
  if (label.startsWith('<binary')) return { cat: 'Binary', color: 'default' }
  return { cat: 'Misc', color: 'cyan' }
}

const ALL_CATS = ['All', 'Player', 'World', 'Score', 'Map', 'Village', 'Actor', 'Binary', 'Misc'] as const
type CatFilter = typeof ALL_CATS[number]

export const LevelDBViewer: React.FC<LevelDBViewerProps> = ({ db, worldName }) => {
  const { openNbtFile } = useEditorStore()
  const { notification } = App.useApp()
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<CatFilter>('Player')
  const [loading, setLoading] = useState<string | null>(null)

  const allEntries = useMemo<KeyEntry[]>(() => {
    const seen = new Set<string>()
    const result: KeyEntry[] = []

    const addKey = (key: Uint8Array) => {
      // Use JSON key string as dedup identity (same as db.ts keyToString)
      const id = JSON.stringify(Array.from(key))
      if (seen.has(id)) return
      seen.add(id)
      const label = describeKey(key)
      // Skip chunk/subchunk keys — tens of thousands, not NBT-editable
      const { cat } = categorise(label)
      if (cat === 'Chunk') return
      result.push({ key, label, category: cat })
    }

    // Enumerate all known NBT keys (singletons + prefix-scanned)
    for (const key of db.iterate()) addKey(key)
    // (no separate well-known probe needed: db.open() already populated them)

    // Sort: Player/World first, then Chunk, then binary
    result.sort((a, b) => {
      const order = (c: string) =>
        ['Player', 'World', 'Score', 'Map', 'Village', 'Actor', 'Misc', 'Binary'].indexOf(c)
      const od = order(a.category) - order(b.category)
      if (od !== 0) return od
      return a.label.localeCompare(b.label)
    })
    return result
  }, [db])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allEntries.filter((e) => {
      if (catFilter !== 'All' && e.category !== catFilter) return false
      if (q && !e.label.toLowerCase().includes(q)) return false
      return true
    })
  }, [allEntries, search, catFilter])

  // Count per category
  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of allEntries) m[e.category] = (m[e.category] ?? 0) + 1
    return m
  }, [allEntries])

  const openKey = async (entry: KeyEntry) => {
    if (!db.has(entry.key)) {
      notification.error({ message: 'Key not found', description: entry.label, duration: 3 })
      return
    }
    setLoading(entry.label)
    try {
      const value = await db.get(entry.key)
      if (!value) throw new Error('Value is empty')
      const doc = await parseNbt((value.buffer as ArrayBuffer).slice(value.byteOffset, value.byteOffset + value.byteLength), {
        kind: 'leveldb',
        worldPath: db.dirPath,
        key: entry.key,
      })
      openNbtFile(doc, entry.label)
    } catch (e) {
      notification.warning({
        message: `Cannot parse "${entry.label}"`,
        description: String(e),
        duration: 5,
      })
    } finally {
      setLoading(null)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '8px 8px 4px', borderBottom: '1px solid #f0f0f0' }}>
        <Input
          size="small"
          prefix={<SearchOutlined />}
          placeholder="Search keys…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
        <Text type="secondary" style={{ fontSize: 11, marginTop: 4, display: 'block' }}>
          <DatabaseOutlined /> {worldName} — {allEntries.length} keys
        </Text>
      </div>

      {/* Category filter buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px', borderBottom: '1px solid #f0f0f0' }}>
        {ALL_CATS.map((cat) => {
          const active = catFilter === cat
          const count = cat === 'All' ? allEntries.length : (counts[cat] ?? 0)
          if (cat !== 'All' && count === 0) return null
          const tagColor: Record<string, string> = {
            Player: 'green', World: 'red', Score: 'orange', Map: 'gold',
            Village: 'purple', Actor: 'volcano', Binary: 'default', Misc: 'cyan', All: 'geekblue',
          }
          return (
            <Tag
              key={cat}
              color={active ? (tagColor[cat] ?? 'default') : undefined}
              style={{
                cursor: 'pointer',
                opacity: active ? 1 : 0.55,
                fontWeight: active ? 600 : 400,
                userSelect: 'none',
                margin: 0,
              }}
              onClick={() => setCatFilter(cat)}
            >
              {cat} {count > 0 && <span style={{ fontSize: 10 }}>{count}</span>}
            </Tag>
          )
        })}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <List
          size="small"
          dataSource={filtered}
          renderItem={(entry) => {
            const { color } = categorise(entry.label)
            return (
              <List.Item
                style={{ cursor: loading ? 'default' : 'pointer', padding: '4px 8px', opacity: loading && loading !== entry.label ? 0.5 : 1 }}
                onClick={() => { if (!loading) openKey(entry) }}
                actions={[
                  <Tag color={color} style={{ fontSize: 10 }}>{entry.category}</Tag>,
                ]}
              >
                <List.Item.Meta
                  avatar={loading === entry.label
                    ? <LoadingOutlined style={{ color: '#1677ff', marginTop: 4 }} spin />
                    : <CodeOutlined style={{ color: '#888', marginTop: 4 }} />}
                  title={
                    <Text style={{ fontSize: 12, fontFamily: 'monospace' }}>
                      {entry.label}
                    </Text>
                  }
                />
              </List.Item>
            )
          }}
        />
      </div>
    </div>
  )
}
