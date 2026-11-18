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
- background_outline_color: #1a1c20
- shading: 3-tone
- dithering: selective
- light_direction: top-left
- pixel_cluster_scale: 2x2 to 3x3

## per_sprite_budget
- max_colors: 48

## assets
- backgrounds:
  - name: bg_fengxian_niche
    size: 768x576
    colors: 48
    animations: none
    reference_wide: images/fengxian_wide.jpg
    reference_head: images/lushena_head.jpg
  - name: bg_cliff_v2
    size: 2112x576
    colors: 32
    animations: none
  - name: bg_promenade_v2
    size: 3200x576
    colors: 24
    animations: none
- ui:
  - name: ui_marker_spot
    size: 32x56
    colors: 16
    animations: idle 2f @ 2fps loop
  - name: ui_marker_spot_done
    size: 32x56
    colors: 16
    animations: none
  - name: ui_panel_9slice_v2
    size: 64x64
    colors: 12
    animations: none
  - name: ui_icon_spot_bridge
    size: 32x32
    colors: 8
    animations: none
  - name: ui_icon_spot_buddha
    size: 32x32
    colors: 8
    animations: none
  - name: ui_icon_spot_cave
    size: 32x32
    colors: 8
    animations: none
  - name: ui_icon_spot_temple
    size: 32x32
    colors: 8
    animations: none
  - name: ui_icon_spot_garden
    size: 32x32
    colors: 8
    animations: none
  - name: ui_stamp_v2
    size: 32x32
    colors: 6
    animations: none
  - name: ui_icon_close
    size: 24x24
    colors: 6
    animations: none
  - name: ui_icon_check
    size: 24x24
    colors: 6
    animations: none
  - name: ui_icon_arrow
    size: 24x24
    colors: 6
    animations: none
  - name: ui_icon_compass
    size: 24x24
    colors: 6
    animations: none
  - name: ui_card_banner
    size: 640x192
    colors: 16
    animations: none
- characters: []
- tiles: []
- items: []
- effects: []

## integration
- world_canvas: 960x540
- ui_layer: DOM overlay with PNG border-image 9-slice
- pixel_font: Fusion Pixel / Zpix subset (local), system fallback
- no_runtime_geometric_ui: true
- integer_pixel_alignment: true

## forbidden
- Anti-aliasing
- Gradient fills
- Partial opacity (1-254 alpha)
- Colors outside declared palette
- Sub-pixel rendering
- Obvious geometric patterns in repeatable terrain
- White speckle noise on terrain tiles
- Runtime fillRect panels/markers used as final UI
