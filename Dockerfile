# syntax=docker/dockerfile:1
#
# CulturalLeader · 一体化镜像
#   FastAPI + 前端静态资源（含 three.js / Live2D 运行时）+ LKH-3.0.14 求解器
#
# 环境变量由使用者自行提供（--env-file .env / -e KEY=… / compose 的 env_file），
# 镜像里不含任何 Key，也不含本机 data/ 与 Live2D 样例模型；详见 docs/07-Docker 部署.md。
#
# 构建（需要联网：pip 源 + npmmirror 抓 three/Live2D）：
#   docker build -t culturalleader:latest .
#   国内加速：docker build --build-arg PIP_INDEX_URL=https://mirrors.aliyun.com/pypi/simple/ -t culturalleader:latest .

ARG PYTHON_IMAGE=python:3.11-slim-bookworm
ARG PIP_INDEX_URL=https://pypi.org/simple

# ── 1) 前端运行时依赖：three.js / pixi / Live2D Cubism Core（免 Node 构建）──
FROM ${PYTHON_IMAGE} AS vendor
ENV PYTHONUNBUFFERED=1
WORKDIR /src
COPY tools/vendor_frontend.py tools/vendor_live2d.py tools/
RUN python tools/vendor_frontend.py \
 && python tools/vendor_live2d.py \
 && test -f frontend/vendor/three/build/three.module.js \
 && test -f frontend/vendor/live2d/live2dcubismcore.global.js

# ── 2) 编译 LKH-3.0.14 求解器（行程重优化用；只保留最终二进制）──
FROM ${PYTHON_IMAGE} AS lkh
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY LKH-3.0.14/ LKH-3.0.14/
RUN make -C LKH-3.0.14 \
 && test -x LKH-3.0.14/LKH

# ── 3) 运行镜像 ──
FROM ${PYTHON_IMAGE} AS runtime
ARG PIP_INDEX_URL
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TZ=Asia/Shanghai

# 时区（日照与时间戳按本地时区显示；容器不装 tzdata 会退回 UTC）
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/* \
 && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
 && echo $TZ > /etc/timezone

WORKDIR /app

# Python 依赖（固定版本，见 requirements.txt）
COPY requirements.txt ./
RUN pip install --index-url ${PIP_INDEX_URL} -r requirements.txt

# 应用代码与文档（不含 .env、不含 data/、不含 Live2D 样例模型，见 .dockerignore）
COPY backend/ backend/
COPY frontend/ frontend/
COPY tools/ tools/
COPY docs/ docs/
COPY licenses/ licenses/
COPY THIRD_PARTY_LICENSES.md README.md .env.example ./

# 前一阶段产物：前端运行时依赖 + LKH 二进制
# （LKH 在这里被真正放进镜像；.dockerignore 排除的只是宿主机上的旧二进制与编译中间件）
COPY --from=vendor /src/frontend/vendor frontend/vendor
COPY --from=lkh /src/LKH-3.0.14/LKH LKH-3.0.14/LKH
RUN test -x LKH-3.0.14/LKH \
 && ldd LKH-3.0.14/LKH > /dev/null \
 && install -d data

# 数据目录：SQLite / 流程 / 攻略 / 导入 / TTS 缓存；建议挂载卷（见 docs/07）
VOLUME ["/app/data"]

# ── 想把当前 data/（SQLite 城市库与 TTS 缓存）一起烤进镜像？──
# 默认不烤，原因有二：
#   1) 城市库不是外部数据：backend/app/seed.py 会在首次启动时自动建库、播种 38 座省级城市；
#   2) flows / guides / imports / tts_cache 是运行期数据，烤进镜像会导致"每次重建都回滚到旧快照"。
# 需要"自带数据的镜像"时：取消下面一行注释，并从 .dockerignore 里删掉 "data/"。
# COPY data/ ./data/

EXPOSE 8000

# 入口脚本：打印启动自检（数据目录 / LKH / Key 状态），再 exec 出 uvicorn
COPY --chmod=755 docker/entrypoint.sh /app/docker/entrypoint.sh
ENTRYPOINT ["/app/docker/entrypoint.sh"]

# 健康检查：/api/health 返回 200 即视为就绪（用 python 自带 urllib，镜像里没有 curl）
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

# 容器里必须监听 0.0.0.0；反向代理场景保留 X-Forwarded-* 处理
CMD ["python", "-m", "uvicorn", "backend.app.main:app", \
     "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
