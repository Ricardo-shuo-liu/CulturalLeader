# 环境音素材（可选）

本目录用于放置**可选的 CC0 / 公有领域音频**。文件命名按用途：

| 文件名 | 用途 |
| --- | --- |
| `wind.webm` / `wind.ogg` / `wind.mp3` | 风声环境底 |
| `water.webm` / `water.ogg` / `water.mp3` | 水声环境底 |
| `guqin.webm` / `guqin.ogg` / `guqin.mp3` | 古琴环境音 / 旅行电影配乐 |

放置规则：

- 三种格式任选其一即可，代码按 `webm → ogg → mp3` 顺序探测；
- 缺少某个文件时会自动回落到**程序化合成**（风声 / 水声为噪声合成，古琴为 Karplus-Strong 拨弦合成，
  见 `frontend/js/audio_assets.js`），因此不放素材也能完整演示；
- 放入素材后，请把**来源、作者与许可**登记到仓库根目录的 `THIRD_PARTY_LICENSES.md`，
  避免把授权不明的音频带进发布物。
