# Execution Lock

## canvas
- base_size: 64x64
- tile_size: 64x64
- viewport: 960x540
- format: RGBA PNG

## palette
- name: InkGongbi48
- colors:
  - #0e0f12
  - #1a1c20
  - #26282b
  - #33322f
  - #403b34
  - #4a4038
  - #5a4c3e
  - #6b5947
  - #7d6852
  - #91785e
  - #a68a68
  - #bda077
  - #d4ba90
  - #e8d2ae
  - #f2e5c8
  - #24352c
  - #2e4636
  - #3a5742
  - #48694e
  - #5b7f5c
  - #73966e
  - #8fae82
  - #aac49a
  - #1b2f38
  - #254452
  - #315866
  - #3f6e7a
  - #54848c
  - #6d9ba0
  - #8bb4b0
  - #3d3350
  - #54405c
  - #744f5e
  - #96655f
  - #b87a62
  - #d18f67
  - #e6a96f
  - #f4c27e
  - #ffd9a0
  - #fff0cc
  - #e8c49c
  - #c99a72
  - #3f6a8a
  - #2e4d66
  - #b5503f
  - #8f3a30
  - #7a5436
  - #2c3a4a

## style
- sub_style: outlined
- outline_color: #0e0f12
- shading: 3-tone
- dithering: selective
- light_direction: top-left

## per_sprite_budget
- max_colors: 24

## assets
- characters:
  - name: player_idle
    size: 64x64
    colors: 16
    animations: idle 4f @ 8fps loop
  - name: player_walk
    size: 64x64
    colors: 16
    animations: walk 6f @ 12fps loop
  - name: player_interact
    size: 64x64
    colors: 16
    animations: interact 4f @ 8fps once
- tiles:
  - name: tile_path_stone
    size: 64x64
    colors: 12
    animations: none
  - name: tile_grass
    size: 64x64
    colors: 10
    animations: none
  - name: tile_stone_wall
    size: 64x64
    colors: 10
    animations: none
- items:
  - name: prop_pine_01
    size: 128x192
    colors: 14
    animations: none
  - name: prop_willow_01
    size: 128x192
    colors: 16
    animations: none
  - name: prop_lamp
    size: 64x128
    colors: 10
    animations: none
  - name: prop_bench
    size: 64x64
    colors: 8
    animations: none
  - name: prop_sign
    size: 64x64
    colors: 8
    animations: none
  - name: prop_bridge
    size: 512x192
    colors: 16
    animations: none
  - name: prop_gate
    size: 192x256
    colors: 16
    animations: none
  - name: prop_moon_gate
    size: 128x192
    colors: 14
    animations: none
  - name: prop_railing
    size: 64x64
    colors: 8
    animations: none
  - name: prop_stone_step
    size: 128x64
    colors: 8
    animations: none
- ui:
  - name: ui_panel_9slice
    size: 48x48
    colors: 8
    animations: none
  - name: ui_icon_bridge
    size: 16x16
    colors: 6
    animations: none
  - name: ui_icon_buddha
    size: 16x16
    colors: 6
    animations: none
  - name: ui_icon_cave
    size: 16x16
    colors: 6
    animations: none
  - name: ui_icon_temple
    size: 16x16
    colors: 6
    animations: none
  - name: ui_icon_garden
    size: 16x16
    colors: 6
    animations: none
  - name: ui_stamp
    size: 24x24
    colors: 4
    animations: none
- effects:
  - name: fx_glow
    size: 64x64
    colors: 6
    animations: none
  - name: fx_petal
    size: 8x8
    colors: 4
    animations: none
  - name: fx_ripple
    size: 32x16
    colors: 4
    animations: none
  - name: fx_bird
    size: 16x8
    colors: 3
    animations: none
- backgrounds:
  - name: bg_sky
    size: 960x576
    colors: 14
    animations: none
  - name: bg_far_hills
    size: 1280x576
    colors: 8
    animations: none
  - name: bg_cliff
    size: 2112x576
    colors: 24
    animations: none
  - name: bg_river
    size: 2560x576
    colors: 12
    animations: none
  - name: bg_promenade
    size: 3200x576
    colors: 18
    animations: none
  - name: bg_foreground
    size: 3776x576
    colors: 10
    animations: none

## forbidden
- Anti-aliasing
- Gradient fills
- Partial opacity (1-254 alpha)
- Colors outside declared palette
- Sub-pixel rendering
- Obvious geometric patterns in repeatable terrain
- White speckle noise on terrain tiles
