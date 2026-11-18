# CulturalLeader 项目规则

## 像素美术必须使用 pixel-asset-master

本项目所有 2D 像素美术、游戏画面、素材生成与修改任务，必须使用项目级技能：

`.claude/skills/pixel-asset-master/SKILL.md`

强制要求：

1. 开始任何像素素材工作前，先读取并遵循该技能的完整流水线（Step 1–7）。
2. 风格确认（Step 3）与六项确认（Step 4）是 BLOCKING 步骤，必须等待用户明确确认。
3. 生成任何素材前必须重新读取 `spec_lock.md`；颜色、尺寸、风格只能取自该文件。
4. 素材项目统一放在项目根 `projects/`（已通过 `PIXEL_ASSET_PROJECTS_DIR` 适配）。
5. 素材必须通过 `asset_validator.py` 校验后，才可接入前端。
6. 该技能只在本项目生效，不要安装到用户全局 `~/.claude/skills/`。
7. 接入游戏素材时优先使用生成的 PNG 资产，不要在运行时用简单几何图形临时凑画面。

## 当前相关入口

- 龙门石窟 2D demo：`frontend/demo/longmen_park.html`
- 中国地图旅行 demo：`frontend/demo/pixel_travel.html`
