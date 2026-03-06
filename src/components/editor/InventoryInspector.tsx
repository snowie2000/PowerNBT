import React, { useState, memo, useCallback } from 'react'
import { Select, InputNumber, Button } from 'antd'
import itemsWebp from '../../assets/items.webp'
import {
  BEDROCK_ENCHANT, JAVA_ENCHANT, toRoman,
  MC_COLOR, JSON_COLOR, itemDisplayName, itemIconColor, SPRITE_POS,
} from '../../lib/minecraft/itemData'
import { TAG, type NbtNode } from '../../lib/nbt/types'
import { useEditorStore } from '../../store/useEditorStore'

// ── Minecraft text parsing ────────────────────────────────────────────────────

function parseMcText(raw: string): React.ReactNode {
  if (!raw) return null
  if (raw.trimStart().startsWith('{') || raw.trimStart().startsWith('[')) {
    try { return renderJson(JSON.parse(raw)) } catch { /* fall through */ }
  }
  return renderSection(raw)
}

function renderJson(obj: unknown): React.ReactNode {
  if (typeof obj === 'string') return obj
  if (Array.isArray(obj)) return <>{obj.map((e, i) => <React.Fragment key={i}>{renderJson(e)}</React.Fragment>)}</>
  if (typeof obj !== 'object' || !obj) return ''
  const o = obj as Record<string, unknown>
  const rawColor = typeof o.color === 'string' ? o.color : undefined
  const style: React.CSSProperties = {
    color: rawColor ? (JSON_COLOR[rawColor] ?? rawColor) : undefined,
    fontWeight: o.bold === true ? 'bold' : undefined,
    fontStyle: o.italic === true ? 'italic' : undefined,
    textDecoration: o.underline === true ? 'underline' : undefined,
  }
  const text = typeof o.text === 'string' ? o.text : ''
  const extras = Array.isArray(o.extra)
    ? o.extra.map((e, i) => <React.Fragment key={i}>{renderJson(e)}</React.Fragment>)
    : null
  return <span style={style}>{text}{extras}</span>
}

function renderSection(text: string): React.ReactNode {
  const spans: React.ReactNode[] = []
  let color: string | undefined, bold = false, italic = false, underline = false
  let buf = '', idx = 0
  const flush = () => {
    if (!buf) return
    spans.push(
      <span key={idx++} style={{ color, fontWeight: bold ? 'bold' : undefined, fontStyle: italic ? 'italic' : undefined, textDecoration: underline ? 'underline' : undefined }}>
        {buf}
      </span>
    )
    buf = ''
  }
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '§' && i + 1 < text.length) {
      flush()
      const c = text[++i].toLowerCase()
      if (MC_COLOR[c]) { color = MC_COLOR[c]; bold = false; italic = false; underline = false }
      else if (c === 'r') { color = undefined; bold = false; italic = false; underline = false }
      else if (c === 'l') bold = true
      else if (c === 'o') italic = true
      else if (c === 'n') underline = true
    } else { buf += text[i] }
  }
  flush()
  return spans.length ? <>{spans}</> : text
}

// ── NBT traversal helpers ─────────────────────────────────────────────────────

function child(node: NbtNode, ...names: string[]): NbtNode | undefined {
  for (const n of names) {
    const c = node.children?.find(ch => ch.name === n)
    if (c) return c
  }
}

function numVal(node: NbtNode, ...names: string[]): number | null {
  const c = child(node, ...names)
  if (!c || c.value == null) return null
  return typeof c.value === 'bigint' ? Number(c.value) : (c.value as number)
}

function strVal(node: NbtNode, ...names: string[]): string | null {
  const c = child(node, ...names)
  return c?.type === TAG.String ? (c.value as string) : null
}

// ── Item parsing ──────────────────────────────────────────────────────────────

export interface McItem {
  id: string
  count: number
  slot: number | null
  customName: string | null
  lore: string[]
  enchants: { name: string; lvl: number }[]
  damage: number | null
  isAir: boolean
}

export function parseItem(node: NbtNode): McItem {
  const id = strVal(node, 'id', 'Name') ?? 'minecraft:air'
  const count = numVal(node, 'Count', 'count') ?? 1
  const slot = numVal(node, 'Slot', 'slot')
  const tagNode = child(node, 'tag')
  const components = child(node, 'components')
  const enchants: { name: string; lvl: number }[] = []

  // Bedrock: tag.ench = List<Compound { id: Short, lvl: Short }>
  tagNode && child(tagNode, 'ench')?.children?.forEach(e => {
    const eid = numVal(e, 'id')
    const elvl = numVal(e, 'lvl')
    if (eid != null) enchants.push({ name: BEDROCK_ENCHANT[eid] ?? `Enchantment #${eid}`, lvl: elvl ?? 1 })
  })

  // Java ≤1.20.4: tag.Enchantments / tag.StoredEnchantments = List<Compound { id: String, lvl: Int }>
  const javaEnchList = tagNode && (child(tagNode, 'Enchantments') ?? child(tagNode, 'StoredEnchantments'))
  javaEnchList?.children?.forEach(e => {
    const eid = strVal(e, 'id')
    const elvl = numVal(e, 'lvl', 'Lvl')
    if (eid) {
      const name = JAVA_ENCHANT[eid] ?? eid.replace(/^minecraft:/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      enchants.push({ name, lvl: elvl ?? 1 })
    }
  })

  // Java 1.20.5+: components["minecraft:enchantments"].levels = Compound { id: Int }
  const addComponentEnchants = (compKey: string) => {
    const ec = components && child(components, compKey)
    ec && child(ec, 'levels')?.children?.forEach(c => {
      const name = JAVA_ENCHANT[c.name] ?? c.name.replace(/^minecraft:/, '').replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase())
      enchants.push({ name, lvl: typeof c.value === 'number' ? c.value : 1 })
    })
  }
  addComponentEnchants('minecraft:enchantments')
  addComponentEnchants('minecraft:stored_enchantments')

  // Display name: tag.display.Name (§-codes or JSON) or components["minecraft:custom_name"]
  let customName = (tagNode && child(tagNode, 'display') && strVal(child(tagNode, 'display')!, 'Name')) ?? null
  if (!customName && components) customName = strVal(components, 'minecraft:custom_name')

  // Lore: tag.display.Lore = List<String> or components["minecraft:lore"]
  const lore: string[] = []
  const dispNode = tagNode && child(tagNode, 'display')
  dispNode && child(dispNode, 'Lore')?.children?.forEach(c => {
    if (c.type === TAG.String && typeof c.value === 'string') lore.push(c.value)
  })
  if (!lore.length && components) {
    child(components, 'minecraft:lore')?.children?.forEach(c => {
      if (c.type === TAG.String && typeof c.value === 'string') lore.push(c.value)
    })
  }

  // Damage (durability used)
  let damage = tagNode ? numVal(tagNode, 'Damage') : null
  if (damage == null) {
    const dmgComp = components && child(components, 'minecraft:damage')
    if (dmgComp && typeof dmgComp.value === 'number') damage = dmgComp.value
  }

  const isAir = !id || id === 'minecraft:air' || id === 'air'
  return { id, count, slot, customName, lore, enchants, damage, isAir }
}

// ── Detection ─────────────────────────────────────────────────────────────────

export function isItemNode(node: NbtNode): boolean {
  if (node.type !== TAG.Compound) return false
  const ch = node.children ?? []
  const hasId = ch.some(c =>
    (c.name === 'id' || c.name === 'Name') && c.type === TAG.String &&
    typeof c.value === 'string' && c.value.includes(':')
  )
  const hasCount = ch.some(c =>
    (c.name === 'Count' || c.name === 'count') &&
    (c.type === TAG.Byte || c.type === TAG.Short || c.type === TAG.Int)
  )
  return hasId && hasCount
}

const INVENTORY_NAMES = new Set([
  'Inventory', 'Items', 'HandItems', 'ArmorItems', 'EnderItems',
  'inventory', 'items', 'Equipment',
])

export function isInventoryNode(node: NbtNode): boolean {
  if (!INVENTORY_NAMES.has(node.name)) return false
  if (node.type !== TAG.List) return false
  const children = node.children ?? []
  return children.length === 0 || children.some(isItemNode)
}

// ── ItemIcon ──────────────────────────────────────────────────────────────────

const ItemIcon = memo(function ItemIcon({ id, size = 32 }: { id: string; size?: number }) {
  const pos = SPRITE_POS[id]
  const scale = size / 16

  if (pos) {
    return (
      <div style={{
        width: size, height: size, flexShrink: 0,
        backgroundImage: `url(${itemsWebp})`,
        backgroundSize: `${256 * scale}px ${1072 * scale}px`,
        backgroundPosition: `-${pos[0] * size}px -${pos[1] * size}px`,
        imageRendering: 'pixelated',
      }} />
    )
  }

  if (!id || id === 'minecraft:air' || id === 'air') {
    return <div style={{ width: size, height: size, flexShrink: 0, background: '#1c1c1c', border: '1px solid #333', boxSizing: 'border-box' }} />
  }

  const bg = itemIconColor(id)
  const label = id.replace(/^minecraft:/, '').split('_').map(w => w[0]?.toUpperCase() ?? '').slice(0, 3).join('')
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
      border: '1px solid rgba(255,255,255,0.15)', boxSizing: 'border-box',
    }}>
      <span style={{ fontSize: size * 0.35, fontFamily: 'monospace', fontWeight: 'bold', color: 'rgba(255,255,255,0.85)', userSelect: 'none', lineHeight: 1 }}>
        {label}
      </span>
    </div>
  )
})

// ── Tooltip card ──────────────────────────────────────────────────────────────

const MC: React.CSSProperties = { fontFamily: 'monospace, ui-monospace', letterSpacing: '0.04em' }

function TooltipCard({ item }: { item: McItem }) {
  if (item.isAir) return (
    <div style={{ ...MC, color: '#555', fontSize: 13, padding: '8px 0' }}>Empty slot</div>
  )

  const nameNode = item.customName
    ? <span style={{ fontSize: 14 }}>{parseMcText(item.customName)}</span>
    : <span style={{ color: '#FFFF55', fontSize: 14 }}>{itemDisplayName(item.id)}</span>

  return (
    <div style={{
      ...MC,
      display: 'inline-flex', flexDirection: 'column', gap: 3,
      background: '#100010',
      border: '2px solid #5C00A3',
      boxShadow: 'inset 0 0 0 1px #2A0033, 3px 3px 12px rgba(0,0,0,0.9)',
      padding: '10px 12px',
      minWidth: 160, maxWidth: 320,
    }}>
      {/* Name + icon row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
        <ItemIcon id={item.id} size={32} />
        <div style={{ minWidth: 0 }}>
          {nameNode}
          {item.customName && (
            <div style={{ color: '#888', fontSize: 11, marginTop: 1 }}>{itemDisplayName(item.id)}</div>
          )}
        </div>
      </div>

      {/* Enchantments */}
      {item.enchants.map((e, i) => (
        <div key={i} style={{ color: '#9999EE', fontSize: 13 }}>{e.name} {toRoman(e.lvl)}</div>
      ))}

      {/* Divider between enchants and lore */}
      {item.enchants.length > 0 && item.lore.length > 0 && (
        <div style={{ borderTop: '1px solid #3A003A', margin: '2px 0' }} />
      )}

      {/* Lore */}
      {item.lore.map((line, i) => (
        <div key={i} style={{ color: '#AA00AA', fontStyle: 'italic', fontSize: 12 }}>
          {parseMcText(line)}
        </div>
      ))}

      {/* Footer */}
      <div style={{ borderTop: '1px solid #2A002A', marginTop: 4, paddingTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ color: '#666', fontSize: 11 }}>Count: <span style={{ color: '#999' }}>{item.count}</span></span>
        {item.slot != null && <span style={{ color: '#666', fontSize: 11 }}>Slot: <span style={{ color: '#999' }}>{item.slot}</span></span>}
        {item.damage != null && item.damage > 0 && <span style={{ color: '#666', fontSize: 11 }}>Damage: <span style={{ color: '#FF8888' }}>{item.damage}</span></span>}
        <span style={{ color: '#3A3A3A', fontSize: 10, fontFamily: 'monospace', flex: '1 1 100%', wordBreak: 'break-all' }}>{item.id}</span>
      </div>
    </div>
  )
}

// ── Inventory slot cell ───────────────────────────────────────────────────────

const SlotCell = memo(function SlotCell({
  node, hotbarLabel, selected, onHover, onClick,
}: {
  node: NbtNode | null
  hotbarLabel?: string
  selected: boolean
  onHover: (key: string | null) => void
  onClick: (n: NbtNode) => void
}) {
  const item = node ? parseItem(node) : null
  const empty = !item || item.isAir
  return (
    <div
      style={{
        width: 36, height: 36, flexShrink: 0,
        background: selected ? '#3A3A1E' : '#2C2C2C',
        border: selected ? '2px solid #FFFF55' : '1px solid #555',
        boxSizing: 'border-box',
        cursor: empty ? 'default' : 'pointer',
        position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'border-color 0.1s, background 0.1s',
      }}
      onMouseEnter={() => !empty && node && onHover(node.key)}
      onMouseLeave={() => onHover(null)}
      onClick={() => !empty && node && onClick(node)}
    >
      {item && !item.isAir && (
        <>
          <ItemIcon id={item.id} size={28} />
          {item.count > 1 && (
            <span style={{
              position: 'absolute', bottom: 1, right: 2,
              fontSize: 10, fontWeight: 'bold', color: '#fff',
              textShadow: '1px 1px 0 #000, -1px -1px 0 #000',
              lineHeight: 1, userSelect: 'none', fontFamily: 'monospace',
            }}>
              {item.count}
            </span>
          )}
        </>
      )}
      {hotbarLabel && empty && (
        <span style={{ fontSize: 9, color: '#444', userSelect: 'none', position: 'absolute', bottom: 1, right: 2 }}>
          {hotbarLabel}
        </span>
      )}
    </div>
  )
})

// ── Inventory grid ────────────────────────────────────────────────────────────

function InventoryGrid({ node, selectedKey, onSelect }: {
  node: NbtNode
  selectedKey: string | null
  onSelect: (n: NbtNode) => void
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const items = node.children ?? []

  // Build slot → node map
  const slotMap = new Map<number, NbtNode>()
  let maxSlot = -1
  let anySlot = false
  for (const item of items) {
    const s = numVal(item, 'Slot', 'slot')
    if (s != null && s >= 0 && s < 300) {
      slotMap.set(s, item)
      if (s > maxSlot) maxSlot = s
      anySlot = true
    }
  }

  // Small inventory (HandItems, ArmorItems ≤4 items) — display in a single row with labels
  if (!anySlot || items.length <= 6) {
    const labels = node.name === 'ArmorItems'
      ? ['Boots', 'Leggings', 'Chestplate', 'Helmet']
      : node.name === 'HandItems'
        ? ['Mainhand', 'Offhand']
        : undefined
    return (
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {items.map((item, i) => (
          <div key={item.key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <SlotCell node={item} selected={selectedKey === item.key || hoverKey === item.key} onHover={setHoverKey} onClick={onSelect} />
            {labels && <span style={{ fontSize: 9, color: '#555', fontFamily: 'monospace' }}>{labels[i]}</span>}
          </div>
        ))}
      </div>
    )
  }

  // Player inventory (slots 0-35): show 3 rows of main + hotbar
  const isPlayerInv = maxSlot <= 35 && slotMap.has(0)
  if (isPlayerInv) {
    const mainRows = [
      Array.from({ length: 9 }, (_, i) => i + 9),
      Array.from({ length: 9 }, (_, i) => i + 18),
      Array.from({ length: 9 }, (_, i) => i + 27),
    ]
    const hotbar = Array.from({ length: 9 }, (_, i) => i)
    const renderRow = (slots: number[], rowLabel?: string) => (
      <div style={{ display: 'flex', gap: 2 }}>
        {slots.map(s => {
          const n = slotMap.get(s) ?? null
          return (
            <SlotCell
              key={s}
              node={n}
              hotbarLabel={rowLabel ? String(s === 0 ? 1 : s + 1) : undefined}
              selected={n ? (selectedKey === n.key || hoverKey === n.key) : false}
              onHover={setHoverKey}
              onClick={onSelect}
            />
          )
        })}
      </div>
    )
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {mainRows.map((row, i) => <div key={i}>{renderRow(row)}</div>)}
        <div style={{ borderTop: '1px solid #3A3A3A', margin: '2px 0' }} />
        {renderRow(hotbar, 'hotbar')}
      </div>
    )
  }

  // Generic chest / other inventory: fill 9-wide rows from slot 0
  const rows: number[][] = []
  for (let r = 0; r <= maxSlot; r += 9) {
    rows.push(Array.from({ length: Math.min(9, maxSlot - r + 1) }, (_, i) => r + i))
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map((row, ri) => (
        <div key={ri} style={{ display: 'flex', gap: 2 }}>
          {row.map(s => {
            const n = slotMap.get(s) ?? null
            return (
              <SlotCell
                key={s}
                node={n}
                selected={n ? (selectedKey === n.key || hoverKey === n.key) : false}
                onHover={setHoverKey}
                onClick={onSelect}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Enchantment editor ────────────────────────────────────────────────────────

/** Stable select options — built once outside the component */
const ENCHANT_OPTIONS = Object.entries(BEDROCK_ENCHANT)
  .map(([id, name]) => ({ value: Number(id), label: name }))
  .sort((a, b) => a.label.localeCompare(b.label))

interface EnchantmentEditorProps {
  itemNode: NbtNode
  fileIndex: number
}

function EnchantmentEditor({ itemNode, fileIndex }: EnchantmentEditorProps) {
  const { updateNodeValue, deleteNode, updateNodeFull } = useEditorStore()
  const [addId, setAddId] = useState<number | null>(null)
  const [addLvl, setAddLvl] = useState<number>(1)

  // Parse current enchantments directly from NBT node
  const tagNode = itemNode.children?.find(c => c.name === 'tag')
  const enchListNode = tagNode?.children?.find(c => c.name === 'ench')
  const enchCompounds = enchListNode?.children ?? []

  type DisplayEnchant = { compoundKey: string; lvlKey: string | undefined; id: number; lvl: number; name: string }
  const displayEnchants: DisplayEnchant[] = enchCompounds.map(e => {
    const idNode = e.children?.find(c => c.name === 'id')
    const lvlNode = e.children?.find(c => c.name === 'lvl')
    const id = typeof idNode?.value === 'number' ? idNode.value : 0
    return {
      compoundKey: e.key,
      lvlKey: lvlNode?.key,
      id,
      lvl: typeof lvlNode?.value === 'number' ? lvlNode.value : 1,
      name: BEDROCK_ENCHANT[id] ?? `Enchantment #${id}`,
    }
  })

  const onLevelChange = useCallback((lvlKey: string, val: number) => {
    updateNodeValue(fileIndex, lvlKey, val)
  }, [fileIndex, updateNodeValue])

  const onRemove = useCallback((compoundKey: string) => {
    deleteNode(fileIndex, compoundKey)
  }, [fileIndex, deleteNode])

  const onAdd = useCallback(() => {
    if (addId == null) return
    const ts = Date.now()
    updateNodeFull(fileIndex, itemNode.key, item => {
      // Find or create `tag` compound
      const existingTag = item.children?.find(c => c.name === 'tag')
      const tagKey = existingTag?.key ?? `${item.key}__tag__${ts}`
      const tagNode: NbtNode = existingTag ?? {
        key: tagKey, type: TAG.Compound, name: 'tag', value: null, children: [],
      }

      // Find or create `ench` list
      const existingEnch = tagNode.children?.find(c => c.name === 'ench')
      const enchKey = existingEnch?.key ?? `${tagKey}__ench__${ts}`
      const existingEnchants = existingEnch?.children ?? []

      // Build new enchantment compound
      const newEnch: NbtNode = {
        key: `${enchKey}__e${ts}_${addId}`,
        type: TAG.Compound, name: '', value: null,
        children: [
          { key: `${enchKey}__e${ts}_${addId}_id`, type: TAG.Short, name: 'id', value: addId, children: undefined, listType: undefined },
          { key: `${enchKey}__e${ts}_${addId}_lvl`, type: TAG.Short, name: 'lvl', value: addLvl, children: undefined, listType: undefined },
        ],
      }

      const newEnchList: NbtNode = {
        key: enchKey, type: TAG.List, name: 'ench', value: null, listType: TAG.Compound,
        children: [...existingEnchants, newEnch],
      }

      const newTagNode: NbtNode = {
        ...tagNode,
        children: [...(tagNode.children?.filter(c => c.name !== 'ench') ?? []), newEnchList],
      }

      return {
        ...item,
        children: [...(item.children?.filter(c => c.name !== 'tag') ?? []), newTagNode],
      }
    })
    setAddId(null)
    setAddLvl(1)
  }, [addId, addLvl, fileIndex, itemNode.key, updateNodeFull])

  const appliedIds = new Set(displayEnchants.map(e => e.id))
  const availableOptions = ENCHANT_OPTIONS.filter(o => !appliedIds.has(o.value))

  const panelStyle: React.CSSProperties = {
    background: '#141414',
    border: '1px solid #3A003A',
    borderRadius: 4,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontFamily: 'monospace, ui-monospace',
    minWidth: 280,
  }

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={{ color: '#9999EE', fontSize: 12, fontWeight: 'bold', letterSpacing: '0.08em', borderBottom: '1px solid #2A002A', paddingBottom: 5, marginBottom: 2 }}>
        ✦ ENCHANTMENTS
      </div>

      {/* Current enchantments */}
      {displayEnchants.length === 0 ? (
        <div style={{ color: '#555', fontSize: 12, fontStyle: 'italic' }}>No enchantments</div>
      ) : (
        displayEnchants.map(e => (
          <div key={e.compoundKey} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#9999EE', fontSize: 13, flex: 1 }}>{e.name}</span>
            <InputNumber
              min={1} max={255} size="small"
              value={e.lvl}
              onChange={v => v != null && e.lvlKey && onLevelChange(e.lvlKey, v)}
              style={{ width: 58 }}
            />
            <span style={{ color: '#666', fontSize: 12, width: 24, textAlign: 'left' }}>{toRoman(e.lvl)}</span>
            <Button
              size="small" danger type="text"
              onClick={() => onRemove(e.compoundKey)}
              style={{ padding: '0 4px', lineHeight: 1, height: 22, color: '#ff4d4f', fontSize: 16 }}
            >×</Button>
          </div>
        ))
      )}

      {/* Add row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderTop: '1px solid #2A002A', paddingTop: 6, marginTop: 2, flexWrap: 'wrap' }}>
        <Select
          placeholder="Add enchantment…"
          options={availableOptions}
          value={addId}
          onChange={v => setAddId(v ?? null)}
          showSearch
          allowClear
          filterOption={(input, opt) => (opt?.label ?? '').toLowerCase().includes(input.toLowerCase())}
          size="small"
          style={{ flex: '1 1 140px', minWidth: 0 }}
          popupMatchSelectWidth={false}
        />
        <InputNumber
          min={1} max={255} value={addLvl}
          onChange={v => v != null && setAddLvl(v)}
          size="small" style={{ width: 58 }}
        />
        <Button
          size="small" type="primary"
          disabled={addId == null}
          onClick={onAdd}
          style={{ flexShrink: 0 }}
        >
          + Add
        </Button>
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function InventoryInspector({ node, fileIndex }: { node: NbtNode; fileIndex: number }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  // Single item compound
  if (isItemNode(node)) {
    return (
      <div style={{ padding: '0 0 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <TooltipCard item={parseItem(node)} />
        <EnchantmentEditor itemNode={node} fileIndex={fileIndex} />
      </div>
    )
  }

  // Inventory list
  const items = node.children ?? []
  const nonAirCount = items.filter(c => { try { return !parseItem(c).isAir } catch { return false } }).length
  const selectedNode = selectedKey ? items.find(c => c.key === selectedKey) ?? null : null
  const selectedItem = selectedNode ? parseItem(selectedNode) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Header */}
      <div style={{ color: '#777', fontSize: 12, fontFamily: 'monospace' }}>
        {node.name} — {nonAirCount} / {items.length} items
      </div>

      {/* Grid */}
      <div style={{ background: '#1a1a1a', padding: 8, borderRadius: 4, display: 'inline-flex' }}>
        <InventoryGrid
          node={node}
          selectedKey={selectedKey}
          onSelect={n => setSelectedKey(prev => prev === n.key ? null : n.key)}
        />
      </div>

      {/* Selected item details */}
      {selectedItem && !selectedItem.isAir && selectedNode && (
        <>
          <TooltipCard item={selectedItem} />
          <EnchantmentEditor itemNode={selectedNode} fileIndex={fileIndex} />
        </>
      )}
    </div>
  )
}
