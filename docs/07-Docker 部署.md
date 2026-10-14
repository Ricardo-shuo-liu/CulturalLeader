# Docker 部署

> 相关文档：[05-开发与校验](05-开发与校验.md) · [06-千年与旅行电影](06-千年与旅行电影.md)
> · [04-语音与数字人](04-语音与数字人.md)

镜像把三件东西打在一起：**FastAPI 服务 + 前端静态资源**（含 three.js / Live2D 运行时，构建时从 npmmirror 抓取，
免 Node 构建）、**LKH-3.0.14 求解器**（构建时编译，行程重优化用）。**环境变量由你自己提供**——
镜像里不含任何 Key、不含本机 `data/`、也不含 Live2D 样例模型。

---

## 一、三步起服务

```bash
cp .env.example .env          # ① 填 Key（全留空也能跑：本地 Mock 讲解 + 浏览器语音 + 估算通勤）
docker compose up -d --build  # ② 构建并后台启动（首次构建需要联网）
# ③ 打开 http://127.0.0.1:8000/ ，后台在 /admin（默认令牌 dev-token，改 .env 里的 ADMIN_TOKEN）
```

不用 compose 也可以：

```bash
docker build -t culturalleader:latest .
docker run -d --name culturalleader \
  -p 8000:8000 \
  --env-file .env \
  -v "$PWD/data:/app/data" \
  -v "$PWD/frontend/assets/live2d/model:/app/frontend/assets/live2d/model:ro" \
  culturalleader:latest
```

- 国内网络构建慢时：
  `docker build --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ -t culturalleader:latest .`
  （`docker compose` 同理：`PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ docker compose up -d --build`）
- 环境变量支持三种给法：`--env-file .env`、`-e OPENAI_API_KEY=...`、或 compose 的 `env_file`。
  **推荐用 `.env`**，与本地 `run.sh` 的运行方式完全一致。

启动时容器会打印一次「启动自检」，一眼看清哪些能力已就绪、哪些在降级运行：

```
CulturalLeader 启动自检
  数据目录   /app/data（首次启动，将自动建库播种）
  行程求解   LKH-3.0.14 已就绪
  地图服务   未配置 Key：自建矢量底图 + 通勤估算
  大模型     未配置：本地知识库 Mock 讲解
  语音合成   云端 TTS（音色 FunAudioLLM/CosyVoice2-0.5B:diana）
  数字人形象 已挂载模型
```

---

## 二、环境变量

全部变量以 [`.env.example`](../.env.example) 为准，下面只讲"不配置会发生什么"：

| 变量 | 作用 | 不配置时 |
| --- | --- | --- |
| `TENCENT_MAP_KEY` / `TENCENT_MAP_SK` | 腾讯位置服务 WebServiceAPI：真实通勤时长、POI 搜索、行政区划 | 城内地图走自建矢量底图，通勤时间标注「估算」 |
| `TENCENT_MAP_JS_KEY` | 浏览器端腾讯地图 GL（城内流程编辑的真实底图） | 自动降级为自建矢量底图（同样可拖拽缩放） |
| `MAP_QPS` / `MAP_DAILY_LIMIT` / `ALLOW_ESTIMATE` | 限流与降级策略 | 默认 3 QPS / 5000 次/日 / 允许估算 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `CHAT_MODEL` | 大模型对话（城市讲解、朝代对话、当朝人设） | 退回本地知识库 Mock 讲解（可完整演示） |
| `TTS_BASE_URL` / `TTS_API_KEY` / `TTS_MODEL` / `TTS_VOICE` | 云端语音合成（数字人开口） | 退回浏览器语音；**云端就绪时不会退回系统语音**（避免 espeak 念中文） |
| `ASR_BASE_URL` / `ASR_API_KEY` / `ASR_MODEL` | 语音识别（按住说话） | 退回浏览器识别 / 只能用文字输入 |
| `MOCK_MODE` | `on` 强制本地 Mock | `auto`：没配 `OPENAI_API_KEY` 时自动 Mock |
| `ADMIN_TOKEN` | `/admin` 后台令牌 | 默认 `dev-token`，**对外部署务必改掉** |
| `TZ` | 容器时区（compose 里默认 `Asia/Shanghai`） | 镜像默认 `Asia/Shanghai` |

> 自检：`docker compose exec app python tools/check_map.py`（地图 Key）、
> `docker compose exec app python tools/check_voice.py`（TTS/ASR）。

---

## 三、数据与升级

- 运行数据全部在 `data/`：`app.db`（SQLite 城市库）、`flows/`（流程）、`guides/`（攻略与分享 token）、
  `imports/`、`tts_cache/`（语音缓存）。compose 已把它挂到本机 `./data`。
- **备份 = 拷贝 `data/` 目录**；恢复 = 放回原位再启动。
- 升级：`git pull` 后 `docker compose up -d --build`（数据目录不动，无数据库迁移步骤）。
- 彻底清理：`docker compose down`（保留数据）；`docker compose down -v` 只清匿名卷，`./data` 仍在。

---

## 四、Live2D 形象（注意授权）

- 仓库里的样例模型（Hiyori）**仅限内部评估与培训**，因此**没有打进镜像**；
  compose 默认把本机 `./frontend/assets/live2d/model` 以只读方式挂进容器，本地演示照常出形象。
- 换模型：把符合接入要求的模型目录放到 `frontend/assets/live2d/model/`（见
  [数字人（Live2D）接入说明](数字人（Live2D）接入说明.md) 与 `frontend/assets/live2d/config.json`），
  重启容器即可；不想用模型时删掉 compose 里那行挂载，界面会提示"放入形象"。
- 对外发布前请替换为自有/授权模型（见 [THIRD_PARTY_LICENSES](../THIRD_PARTY_LICENSES.md)）。

---

## 五、LKH 求解器

- 镜像构建时用 `gcc/make` 编译 `LKH-3.0.14`，只保留最终二进制（源码不进运行镜像）。
- 求解失败或节点超限时，后端自动退回内置启发式（插入法 + 2-opt），功能不受影响。
- LKH 为作者分发的学术/研究用途代码，**商用前请与作者确认授权**（见 THIRD_PARTY_LICENSES）。

---

## 六、常用运维命令

```bash
docker compose logs -f app                 # 看日志（启动时会打印一次「启动自检」：数据目录 / LKH / Key 状态）
docker compose ps                          # 容器状态（含 healthy）
docker compose exec app sh                 # 进容器
docker compose exec app python tools/check_voice.py   # 语音自检
curl -s http://127.0.0.1:8000/api/health   # 健康检查
docker compose restart app                 # 改完 .env 后重启（env 只在启动时读取）
docker compose down                        # 停止
```

---

## 七、放到公网（反向代理）

uvicorn 已开 `--proxy-headers`，Nginx 片段：

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

- 公网部署请：改 `ADMIN_TOKEN`、给 `.env` 里的 Key 做最小权限、只暴露代理端口（把 compose 的
  `ports` 改成 `127.0.0.1:8000:8000`）。
- 音频/视频录制（旅行电影）依赖**用户浏览器**，服务端不需要 ffmpeg。

---

## 八、两个常见疑问：data 与 LKH

**LKH 在镜像里，只是"你本机那份二进制"没被拷进去。**
构建分两段：`lkh` 阶段用 `build-essential` 从源码 `make -C LKH-3.0.14` 编译，
运行镜像再 `COPY --from=lkh /src/LKH-3.0.14/LKH` 把二进制放到 `/app/LKH-3.0.14/LKH`，
并在构建期断言 `test -x` + `ldd` 通过（源码与编译中间件不进运行镜像）。
`.dockerignore` 排除的只是**宿主机上那份旧二进制**——它可能不是容器架构的产物。
容器启动自检会打印「行程求解 LKH-3.0.14 已就绪」；没就绪时后端自动退回内置启发式，
不会因此无法启动。

**data 不烤进镜像，是因为它可再生、而且属于运行期状态。**

- 城市库不是外部数据：`backend/app/seed.py` 会在**首次启动时自动建库**，
  播种 5 座重点城市并补齐 38 座省会/首府/特别行政区（自检会写「首次启动，将自动建库播种」）；
- `flows/`、`guides/`、`imports/`、`tts_cache/` 是你自己产生的数据。
  烤进镜像意味着**每次重建都会回滚到那一份旧快照**，分享链接、攻略、语音缓存全部倒退；
  放在卷里（compose 默认挂 `./data`）才能跨升级保留；
- 不挂卷也能跑：数据留在容器可写层，`docker restart/stop` 不丢，`docker rm` 才丢——
  所以 compose 默认帮你挂了卷。

如果你**确实**要"自带数据的镜像"（例如无卷离线部署）：

```dockerfile
# 1) 从 .dockerignore 里删掉 "data/" 这一行
# 2) 在 Dockerfile 里取消注释：
# COPY data/ ./data/
docker build -t culturalleader:with-data .
```

或者更稳妥的做法：先起一次容器把数据初始化好，再 `docker cp culturalleader:/app/data ./data`
导出，之后始终以卷的方式挂载。

---

## 九、常见问题

| 现象 | 处理 |
| --- | --- |
| `permission denied /var/run/docker.sock` | 把当前用户加入 docker 组（`sudo usermod -aG docker $USER` 后重新登录），或所有命令加 `sudo` |
| 端口被占用 | `HOST_PORT=9000 docker compose up -d`，或改用 `-p 9000:8000` |
| 构建卡在 pip | 加 `--build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/` |
| 构建卡在 npm 镜像 | `tools/vendor_*.py` 走 `https://registry.npmmirror.com`；需要能访问该站点 |
| 页面能开但没有形象 | 未挂载模型（见第四节），或模型不满足 Cubism 5 要求（`python tools/check_live2d_model.py`） |
| 语音是"念字母"的机械音 | 云端 TTS 未生效且浏览器退回系统语音；配好 `TTS_*` 后重启容器 |
| 时间牌显示的不是北京时间 | compose 里 `TZ` 不是 `Asia/Shanghai`，改后 `docker compose up -d` |
| Apple Silicon 构建慢 | 多阶段里 LKH 走原生编译，`--platform linux/arm64` 直接可用；也可 `--platform linux/amd64` 走 Rosetta 模拟 |
| 完全离线 | 镜像需要构建期联网（pip + npmmirror）。离线机器：在联网机上 `docker save` / `docker load`，或直接用本地 `./run.sh` |
