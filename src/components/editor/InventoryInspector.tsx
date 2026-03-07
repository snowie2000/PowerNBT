import React, { useState, memo, useCallback } from 'react'
import { Select, InputNumber, Button } from 'antd'
import {
  BEDROCK_ENCHANT, JAVA_ENCHANT, toRoman,
  MC_COLOR, JSON_COLOR, itemDisplayName, itemIconColor,
} from '../../lib/minecraft/itemData'
import { itemImage } from '../../lib/minecraft/itemImage'
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
  // Bedrock stores color/data value as Damage directly on the item compound
  if (damage == null) {
    damage = numVal(node, 'Damage')
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
  'Armor', 'EnderChestInventory',
])

const ARMOR_NODE_NAMES = new Set(['ArmorItems', 'Armor'])

export function isArmorNode(node: NbtNode): boolean {
  if (!ARMOR_NODE_NAMES.has(node.name)) return false
  if (node.type !== TAG.List) return false
  const children = node.children ?? []
  return children.length === 0 || children.length <= 4
}

export function isInventoryNode(node: NbtNode): boolean {
  if (!INVENTORY_NAMES.has(node.name)) return false
  if (node.type !== TAG.List) return false
  const children = node.children ?? []
  return children.length === 0 || children.some(isItemNode)
}

// ── ItemIcon ──────────────────────────────────────────────────────────────────

/** Alias (optionally with Bedrock color index `:N`) → canonical image ID */
const ITEM_ALIASES: Record<string, string> = {
  "minecraft:oak_fence_gate": "minecraft:fence_gate",
  "minecraft:oak_door": "minecraft:wooden_door",
  "minecraft:oak_trapdoor": "minecraft:trapdoor",
  "minecraft:oak_pressure_plate": "minecraft:wooden_pressure_plate",
  "minecraft:oak_button": "minecraft:wooden_button",
  "minecraft:block_of_bamboo": "minecraft:bamboo_block",
  "minecraft:block_of_stripped_bamboo": "minecraft:stripped_bamboo_block",
  "minecraft:stone_stairs": "minecraft:normal_stone_stairs",
  "minecraft:stone_slab": "minecraft:stone_block_slab4:2",
  "minecraft:cobblestone_stairs": "minecraft:stone_stairs",
  "minecraft:mossy_cobblestone_slab": "minecraft:stone_block_slab2:5",
  "minecraft:mossy_cobblestone_wall": "minecraft:cobblestone_wall:1",
  "minecraft:stone_bricks": "minecraft:stonebrick",
  "minecraft:cracked_stone_bricks": "minecraft:stonebrick:2",
  "minecraft:stone_brick_wall": "minecraft:cobblestone_wall:7",
  "minecraft:chiseled_stone_bricks": "minecraft:stonebrick:3",
  "minecraft:mossy_stone_bricks": "minecraft:stonebrick:1",
  "minecraft:mossy_stone_brick_slab": "minecraft:stone_block_slab4",
  "minecraft:mossy_stone_brick_wall": "minecraft:cobblestone_wall:8",
  "minecraft:granite_slab": "minecraft:stone_block_slab3:6",
  "minecraft:granite_wall": "minecraft:cobblestone_wall:2",
  "minecraft:polished_granite_slab": "minecraft:stone_block_slab3:7",
  "minecraft:diorite_slab": "minecraft:stone_block_slab3:4",
  "minecraft:diorite_wall": "minecraft:cobblestone_wall:3",
  "minecraft:polished_diorite_slab": "minecraft:stone_block_slab3:5",
  "minecraft:andesite_slab": "minecraft:stone_block_slab3:3",
  "minecraft:andesite_wall": "minecraft:cobblestone_wall:4",
  "minecraft:polished_andesite_slab": "minecraft:stone_block_slab3:2",
  "minecraft:bricks": "minecraft:brick_block",
  "minecraft:brick_wall": "minecraft:cobblestone_wall:6",
  "minecraft:sandstone_wall": "minecraft:cobblestone_wall:5",
  "minecraft:chiseled_sandstone": "minecraft:sandstone:1",
  "minecraft:smooth_sandstone": "minecraft:sandstone:3",
  "minecraft:smooth_sandstone_slab": "minecraft:stone_block_slab2:6",
  "minecraft:cut_sandstone": "minecraft:sandstone:2",
  "minecraft:cut_sandstone_slab": "minecraft:stone_block_slab4:3",
  "minecraft:red_sandstone_slab": "minecraft:stone_block_slab2",
  "minecraft:red_sandstone_wall": "minecraft:cobblestone_wall:12",
  "minecraft:chiseled_red_sandstone": "minecraft:red_sandstone:1",
  "minecraft:smooth_red_sandstone": "minecraft:red_sandstone:3",
  "minecraft:smooth_red_sandstone_slab": "minecraft:stone_block_slab3:1",
  "minecraft:cut_red_sandstone": "minecraft:red_sandstone:2",
  "minecraft:cut_red_sandstone_slab": "minecraft:stone_block_slab4:4",
  "minecraft:prismarine_slab": "minecraft:stone_block_slab2:2",
  "minecraft:prismarine_wall": "minecraft:cobblestone_wall:11",
  "minecraft:prismarine_bricks": "minecraft:prismarine:2",
  "minecraft:prismarine_brick_stairs": "minecraft:prismarine_bricks_stairs",
  "minecraft:prismarine_brick_slab": "minecraft:stone_block_slab2:4",
  "minecraft:dark_prismarine": "minecraft:prismarine:1",
  "minecraft:dark_prismarine_slab": "minecraft:stone_block_slab2:3",
  "minecraft:nether_bricks": "minecraft:nether_brick",
  "minecraft:nether_brick_wall": "minecraft:cobblestone_wall:9",
  "minecraft:red_nether_bricks": "minecraft:red_nether_brick",
  "minecraft:red_nether_brick_slab": "minecraft:stone_block_slab2:7",
  "minecraft:red_nether_brick_wall": "minecraft:cobblestone_wall:13",
  "minecraft:end_stone_bricks": "minecraft:end_bricks",
  "minecraft:end_stone_brick_stairs": "minecraft:end_brick_stairs",
  "minecraft:end_stone_brick_slab": "minecraft:stone_block_slab3",
  "minecraft:end_stone_brick_wall": "minecraft:cobblestone_wall:10",
  "minecraft:purpur_pillar": "minecraft:purpur_block:2",
  "minecraft:purpur_slab": "minecraft:stone_block_slab2:1",
  "minecraft:block_of_coal": "minecraft:coal_block",
  "minecraft:block_of_iron": "minecraft:iron_block",
  "minecraft:block_of_gold": "minecraft:gold_block",
  "minecraft:block_of_redstone": "minecraft:redstone_block",
  "minecraft:block_of_emerald": "minecraft:emerald_block",
  "minecraft:block_of_lapis_lazuli": "minecraft:lapis_block",
  "minecraft:block_of_diamond": "minecraft:diamond_block",
  "minecraft:block_of_netherite": "minecraft:netherite_block",
  "minecraft:block_of_quartz": "minecraft:quartz_block",
  "minecraft:chiseled_quartz_block": "minecraft:quartz_block:1",
  "minecraft:quartz_pillar": "minecraft:quartz_block:2",
  "minecraft:smooth_quartz_block": "minecraft:quartz_block:3",
  "minecraft:smooth_quartz_slab": "minecraft:stone_block_slab4:1",
  "minecraft:block_of_amethyst": "minecraft:amethyst_block",
  "minecraft:block_of_copper": "minecraft:copper_block",
  "minecraft:waxed_block_of_copper": "minecraft:waxed_copper",
  "minecraft:terracotta": "minecraft:hardened_clay",
  "minecraft:light_gray_glazed_terracotta": "minecraft:silver_glazed_terracotta",
  "minecraft:shulker_box": "minecraft:undyed_shulker_box",
  "minecraft:white_bed": "minecraft:bed",
  "minecraft:light_gray_bed": "minecraft:bed:8",
  "minecraft:gray_bed": "minecraft:bed:7",
  "minecraft:black_bed": "minecraft:bed:15",
  "minecraft:brown_bed": "minecraft:bed:12",
  "minecraft:red_bed": "minecraft:bed:14",
  "minecraft:orange_bed": "minecraft:bed:1",
  "minecraft:yellow_bed": "minecraft:bed:4",
  "minecraft:lime_bed": "minecraft:bed:5",
  "minecraft:green_bed": "minecraft:bed:13",
  "minecraft:cyan_bed": "minecraft:bed:9",
  "minecraft:light_blue_bed": "minecraft:bed:3",
  "minecraft:blue_bed": "minecraft:bed:11",
  "minecraft:purple_bed": "minecraft:bed:10",
  "minecraft:magenta_bed": "minecraft:bed:2",
  "minecraft:pink_bed": "minecraft:bed:6",
  "minecraft:white_banner": "minecraft:banner:15",
  "minecraft:light_gray_banner": "minecraft:banner:7",
  "minecraft:gray_banner": "minecraft:banner:8",
  "minecraft:black_banner": "minecraft:banner",
  "minecraft:brown_banner": "minecraft:banner:3",
  "minecraft:red_banner": "minecraft:banner:1",
  "minecraft:orange_banner": "minecraft:banner:14",
  "minecraft:yellow_banner": "minecraft:banner:11",
  "minecraft:lime_banner": "minecraft:banner:10",
  "minecraft:green_banner": "minecraft:banner:2",
  "minecraft:cyan_banner": "minecraft:banner:6",
  "minecraft:light_blue_banner": "minecraft:banner:12",
  "minecraft:blue_banner": "minecraft:banner:4",
  "minecraft:purple_banner": "minecraft:banner:5",
  "minecraft:magenta_banner": "minecraft:banner:13",
  "minecraft:pink_banner": "minecraft:banner:9",
  "minecraft:dirt_path": "minecraft:grass_path",
  "minecraft:coarse_dirt": "minecraft:dirt:1",
  "minecraft:rooted_dirt": "minecraft:dirt_with_roots",
  "minecraft:red_sand": "minecraft:sand:1",
  "minecraft:snow_block": "minecraft:snow",
  "minecraft:snow": "minecraft:snow_layer",
  "minecraft:magma_block": "minecraft:magma",
  "minecraft:lapis_lazuli_ore": "minecraft:lapis_ore",
  "minecraft:deepslate_lapis_lazuli_ore": "minecraft:deepslate_lapis_ore",
  "minecraft:nether_quartz_ore": "minecraft:quartz_ore",
  "minecraft:block_of_raw_iron": "minecraft:raw_iron_block",
  "minecraft:block_of_raw_copper": "minecraft:raw_copper_block",
  "minecraft:block_of_raw_gold": "minecraft:raw_gold_block",
  "minecraft:mushroom_stem": "minecraft:brown_mushroom_block:15",
  "minecraft:flowering_azalea_leaves": "minecraft:azalea_leaves_flowered",
  "minecraft:dead_bush": "minecraft:deadbush",
  "minecraft:dandelion": "minecraft:yellow_flower",
  "minecraft:vines": "minecraft:vine",
  "minecraft:small_dripleaf": "minecraft:small_dripleaf_block",
  "minecraft:frogspawn": "minecraft:frog_spawn",
  "minecraft:lily_pad": "minecraft:waterlily",
  "minecraft:wet_sponge": "minecraft:sponge:1",
  "minecraft:melon": "minecraft:melon_block",
  "minecraft:jack_o'lantern": "minecraft:lit_pumpkin",
  "minecraft:hay_bale": "minecraft:hay_block",
  "minecraft:slime_block": "minecraft:slime",
  "minecraft:block_of_resin": "minecraft:resin_block",
  "minecraft:cobweb": "minecraft:web",
  "minecraft:stonecutter": "minecraft:stonecutter_block",
  "minecraft:chipped_anvil": "minecraft:anvil:4",
  "minecraft:damaged_anvil": "minecraft:anvil:8",
  "minecraft:note_block": "minecraft:noteblock",
  "minecraft:item_frame": "minecraft:frame",
  "minecraft:glow_item_frame": "minecraft:glow_frame",
  "minecraft:skeleton_skull": "minecraft:skull",
  "minecraft:wither_skeleton_skull": "minecraft:skull:1",
  "minecraft:player_head": "minecraft:skull:3",
  "minecraft:zombie_head": "minecraft:skull:2",
  "minecraft:creeper_head": "minecraft:skull:4",
  "minecraft:piglin_head": "minecraft:skull:6",
  "minecraft:dragon_head": "minecraft:skull:5",
  "minecraft:eye_of_ender": "minecraft:ender_eye",
  "minecraft:infested_stone": "minecraft:monster_egg",
  "minecraft:infested_cobblestone": "minecraft:monster_egg:1",
  "minecraft:infested_stone_bricks": "minecraft:monster_egg:2",
  "minecraft:infested_mossy_stone_bricks": "minecraft:monster_egg:3",
  "minecraft:infested_cracked_stone_bricks": "minecraft:monster_egg:4",
  "minecraft:infested_chiseled_stone_bricks": "minecraft:monster_egg:5",
  "minecraft:redstone_dust": "minecraft:redstone",
  "minecraft:redstone_repeater": "minecraft:repeater",
  "minecraft:redstone_comparator": "minecraft:comparator",
  "minecraft:powered_rail": "minecraft:golden_rail",
  "minecraft:minecart_with_hopper": "minecraft:hopper_minecart",
  "minecraft:minecart_with_chest": "minecraft:chest_minecart",
  "minecraft:minecart_with_tnt": "minecraft:tnt_minecart",
  "minecraft:oak_boat_with_chest": "minecraft:oak_chest_boat",
  "minecraft:bamboo_raft_with_chest": "minecraft:bamboo_chest_raft",
  "minecraft:bucket_of_cod": "minecraft:cod_bucket",
  "minecraft:bucket_of_salmon": "minecraft:salmon_bucket",
  "minecraft:bucket_of_tropical_fish": "minecraft:tropical_fish_bucket",
  "minecraft:bucket_of_pufferfish": "minecraft:pufferfish_bucket",
  "minecraft:bucket_of_axolotl": "minecraft:axolotl_bucket",
  "minecraft:bucket_of_tadpole": "minecraft:tadpole_bucket",
  "minecraft:book_and_quill": "minecraft:writable_book",
  "minecraft:spruce_boat_with_chest": "minecraft:spruce_chest_boat",
  "minecraft:birch_boat_with_chest": "minecraft:birch_chest_boat",
  "minecraft:jungle_boat_with_chest": "minecraft:jungle_chest_boat",
  "minecraft:acacia_boat_with_chest": "minecraft:acacia_chest_boat",
  "minecraft:dark_oak_boat_with_chest": "minecraft:dark_oak_chest_boat",
  "minecraft:mangrove_boat_with_chest": "minecraft:mangrove_chest_boat",
  "minecraft:cherry_boat_with_chest": "minecraft:cherry_chest_boat",
  "minecraft:pale_oak_boat_with_chest": "minecraft:pale_oak_chest_boat",
  "minecraft:13_disc": "minecraft:music_disc_13",
  "minecraft:cat_disc": "minecraft:music_disc_cat",
  "minecraft:blocks_disc": "minecraft:music_disc_blocks",
  "minecraft:chirp_disc": "minecraft:music_disc_chirp",
  "minecraft:far_disc": "minecraft:music_disc_far",
  "minecraft:mall_disc": "minecraft:music_disc_mall",
  "minecraft:mellohi_disc": "minecraft:music_disc_mellohi",
  "minecraft:stal_disc": "minecraft:music_disc_stal",
  "minecraft:strad_disc": "minecraft:music_disc_strad",
  "minecraft:ward_disc": "minecraft:music_disc_ward",
  "minecraft:11_disc": "minecraft:music_disc_11",
  "minecraft:music_disc": "minecraft:music_disc_precipice",
  "minecraft:wait_disc": "minecraft:music_disc_wait",
  "minecraft:otherside_disc": "minecraft:music_disc_otherside",
  "minecraft:relic_music_disc": "minecraft:music_disc_relic",
  "minecraft:5_disc": "minecraft:music_disc_5",
  "minecraft:pigstep_disc": "minecraft:music_disc_pigstep",
  "minecraft:tears_disc": "minecraft:music_disc_tears",
  "minecraft:lava_chicken_disc": "minecraft:music_disc_lava_chicken",
  "minecraft:leather_cap": "minecraft:leather_helmet",
  "minecraft:leather_tunic": "minecraft:leather_chestplate",
  "minecraft:leather_pants": "minecraft:leather_leggings",
  "minecraft:turtle_shell": "minecraft:turtle_helmet",
  "minecraft:tipped_arrow": "minecraft:arrow",
  "minecraft:raw_beef": "minecraft:beef",
  "minecraft:steak": "minecraft:cooked_beef",
  "minecraft:raw_porkchop": "minecraft:porkchop",
  "minecraft:raw_mutton": "minecraft:mutton",
  "minecraft:raw_chicken": "minecraft:chicken",
  "minecraft:raw_rabbit": "minecraft:rabbit",
  "minecraft:raw_cod": "minecraft:cod",
  "minecraft:raw_salmon": "minecraft:salmon",
  "minecraft:nether_quartz": "minecraft:quartz",
  "minecraft:wheat_crops": "minecraft:wheat",
  "minecraft:slimeball": "minecraft:slime_ball",
  "minecraft:nether_brick": "minecraft:netherbrick",
  "minecraft:dragon's_breath": "minecraft:dragon_breath",
  "minecraft:rabbit's_foot": "minecraft:rabbit_foot",
  "minecraft:flower_charge_banner_pattern": "minecraft:flower_banner_pattern",
  "minecraft:creeper_charge_banner_pattern": "minecraft:creeper_banner_pattern",
  "minecraft:skull_charge_banner_pattern": "minecraft:skull_banner_pattern",
  "minecraft:thing_banner_pattern": "minecraft:mojang_banner_pattern",
  "minecraft:snout_banner_pattern": "minecraft:piglin_banner_pattern",
  "minecraft:smithing_template": "minecraft:bolt_armor_trim_smithing_template",
  "minecraft:bottle_o'_enchanting": "minecraft:experience_bottle",
  "minecraft:monster_spawner": "minecraft:mob_spawner",
  "minecraft:zombified_piglin_spawn_egg": "minecraft:zombie_pigman_spawn_egg",
  "minecraft:minecart_with_command_block": "minecraft:command_block_minecart",
  "minecraft:map": "minecraft:filled_map",
  "minecraft:jigsaw_block": "minecraft:jigsaw",
  "minecraft:light": "minecraft:light_block"
}

const ItemIcon = memo(function ItemIcon({ id, size = 32, damage }: { id: string; size?: number; damage?: number | null }) {
  if (!id || id === 'minecraft:air' || id === 'air') {
    return <div style={{ width: size, height: size, flexShrink: 0, background: '#1c1c1c', border: '1px solid #333', boxSizing: 'border-box' }} />
  }

  // Try damage-keyed color variant first (Bedrock stores color index in Damage)
  const colorKey = damage != null && damage > 0 ? `${id}:${damage}` : null
  const resolvedColorId = colorKey ? (ITEM_ALIASES[colorKey] ?? colorKey) : null
  const resolvedId = ITEM_ALIASES[id] ?? id
  const src = (resolvedColorId ? itemImage[resolvedColorId] : null) ?? itemImage[resolvedId]

  if (src) {
    return (
      <img
        src={src}
        width={size}
        height={size}
        style={{ flexShrink: 0, imageRendering: 'pixelated', display: 'block' }}
        draggable={false}
      />
    )
  }

  // Fallback: colored tile with abbreviated label
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
        <ItemIcon id={item.id} size={32} damage={item.damage} />
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
          <ItemIcon id={item.id} size={28} damage={item.damage} />
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

// ── Armor panel ──────────────────────────────────────────────────────────────

// Slot order for display: always show Helmet → Chestplate → Leggings → Boots (top → bottom)
// ArmorItems (Java): stored as [Boots(0), Leggings(1), Chestplate(2), Helmet(3)] → reverse
// Armor (Bedrock): stored as [Helmet(0), Chestplate(1), Leggings(2), Boots(3)] → as-is
const ARMOR_SLOT_LABELS = ['Helmet', 'Chestplate', 'Leggings', 'Boots']

function ArmorPanel({ node, selectedKey, onSelect }: {
  node: NbtNode
  selectedKey: string | null
  onSelect: (n: NbtNode) => void
}) {
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const items = node.children ?? []

  // Java ArmorItems: index 0=Boots … 3=Helmet → reverse to show head-to-toe
  // Bedrock Armor: index 0=Helmet … 3=Boots → as-is
  const displayOrder: (NbtNode | null)[] = node.name === 'ArmorItems'
    ? [items[3] ?? null, items[2] ?? null, items[1] ?? null, items[0] ?? null]
    : [items[0] ?? null, items[1] ?? null, items[2] ?? null, items[3] ?? null]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {displayOrder.map((slotNode, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SlotCell
            node={slotNode}
            selected={slotNode ? (selectedKey === slotNode.key || hoverKey === slotNode.key) : false}
            onHover={setHoverKey}
            onClick={onSelect}
          />
          <span style={{ fontSize: 11, color: '#666', fontFamily: 'monospace', userSelect: 'none', minWidth: 64 }}>
            {ARMOR_SLOT_LABELS[i]}
          </span>
        </div>
      ))}
    </div>
  )
}

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

  // Small inventory (HandItems ≤6 items) — display in a single row with labels
  // (ArmorItems / Armor are handled by ArmorPanel before reaching InventoryGrid)
  if (!anySlot || items.length <= 6) {
    const labels = node.name === 'HandItems'
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
              min={1} max={32767} size="small"
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
          min={1} max={32767} value={addLvl}
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

  // Armor node (ArmorItems / Armor) — vertical panel
  if (isArmorNode(node)) {
    const items = node.children ?? []
    const selectedNode = selectedKey
      ? items.find(c => c.key === selectedKey) ?? null
      : null
    const selectedItem = selectedNode ? parseItem(selectedNode) : null
    const nonAirCount = items.filter(c => { try { return !parseItem(c).isAir } catch { return false } }).length

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Header */}
        <div style={{ color: '#777', fontSize: 12, fontFamily: 'monospace' }}>
          {node.name} — {nonAirCount} / 4 armor slots
        </div>

        {/* Vertical armor panel */}
        <div style={{ background: '#1a1a1a', padding: 8, borderRadius: 4, display: 'inline-flex' }}>
          <ArmorPanel
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
