"""本地非遗资料库 RAG。

数据源：项目根目录 asset/（head/waist/tail 三层 × 项目/正文/三元组/传承人）。
索引：SQLite + FTS5(trigram)。不依赖外部向量服务，离线可用、查询毫秒级。
检索：标题词条匹配（bigram FTS）+ 正文 trigram FTS + 短词 LIKE 兜底，结果按分数与实体去重。
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from collections import defaultdict
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable, Iterable, Iterator

from ..config import get_settings

TIERS = ("head", "waist", "tail")
TIER_LABEL = {"head": "UNESCO 名录", "waist": "国家级", "tail": "省级"}
STOPWORDS = (
    "请问", "介绍一下", "介绍", "讲讲", "说说", "讲一讲", "什么", "怎么", "如何", "为什么",
    "哪些", "哪个", "哪里", "多少", "是否", "有关", "关于", "以及", "可以", "能不能",
    "一下", "一个", "一些", "这个", "那个", "我们", "你们", "他们", "我想", "知道",
    "意思", "内容", "特点", "历史", "来源", "情况", "简介", "资料", "讲", "说", "问", "看",
    "的", "了", "吗", "呢", "呀", "啊", "和", "与", "在", "有", "是", "我", "你", "他",
    "她", "它", "这", "那", "请", "里", "中", "都", "也", "就", "很", "还",
)
CATEGORIES = (
    "传统技艺", "民俗", "传统美术", "传统舞蹈", "传统音乐", "民间文学", "传统医药",
    "传统体育、游艺与杂技", "传统戏剧", "曲艺", "民族传统文化保护区", "传统文化保护区",
    "民族民间传统文化之乡", "民族传统文化生态保护区",
)
PROVINCES = (
    "北京", "天津", "河北", "山西", "内蒙古", "辽宁", "吉林", "黑龙江", "上海", "江苏",
    "浙江", "安徽", "福建", "江西", "山东", "河南", "湖北", "湖南", "广东", "广西",
    "海南", "重庆", "四川", "贵州", "云南", "西藏", "陕西", "甘肃", "青海", "宁夏",
    "新疆", "香港", "澳门", "台湾",
)
EDGE_CHARS = "讲说问了是的吗呢啊呀吧嘛哦"
SYNONYMS = {
    "非遗": "非物质文化遗产",
    "传承人": "代表性传承人",
    "国家级": "国家级非物质文化遗产",
}
MAX_TERMS = 10

_lock = threading.RLock()
_state = {"building": False, "last_error": "", "last_build": 0.0}


@dataclass
class RagHit:
    chunk_id: int
    kind: str
    tier: str
    entity_id: str
    title: str
    category: str
    region: str
    source: str
    text: str
    score: float

    def to_dict(self) -> dict:
        return asdict(self)


# ── 路径与元信息 ─────────────────────────────────────────────


def asset_dir() -> Path:
    return Path(get_settings().rag_asset_dir)


def rag_dir() -> Path:
    return Path(get_settings().rag_dir)


def db_path() -> Path:
    return rag_dir() / "ich.db"


def _jsonl_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*.jsonl") if path.is_file())


def asset_signature(root: Path | None = None) -> str:
    root = root or asset_dir()
    files = _jsonl_files(root)
    if not files:
        return "empty"
    total = 0
    newest = 0.0
    for path in files:
        stat = path.stat()
        total += stat.st_size
        newest = max(newest, stat.st_mtime)
    return f"{len(files)}:{total}:{int(newest)}"


def iter_jsonl(path: Path) -> Iterator[dict]:
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue


def _connect(path: Path, readonly: bool = True) -> sqlite3.Connection:
    if readonly:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=15)
    else:
        conn = sqlite3.connect(str(path), timeout=30)
    conn.row_factory = sqlite3.Row
    return conn


def _read_meta(conn: sqlite3.Connection) -> dict:
    try:
        rows = conn.execute("SELECT key, value FROM rag_meta").fetchall()
    except sqlite3.Error:
        return {}
    return {row["key"]: row["value"] for row in rows}


def _table_count(conn: sqlite3.Connection, table: str) -> int:
    try:
        return int(conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
    except sqlite3.Error:
        return 0


# ── 索引构建 ─────────────────────────────────────────────────


def _norm_text(value) -> str:
    if isinstance(value, list):
        return "、".join(str(item) for item in value if item)
    return str(value or "").strip()


def _clip(text: str, limit: int) -> str:
    text = re.sub(r"\s+", " ", str(text or "")).strip()
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _load_triples(path: Path) -> dict[str, dict[str, list[str]]]:
    """subject → predicate → [objects]，用于把事实并进实体卡片。"""
    facts: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    if not path.exists():
        return {}
    for row in iter_jsonl(path):
        subject = _norm_text(row.get("subject"))
        predicate = _norm_text(row.get("predicate"))
        obj = _norm_text(row.get("object"))
        if subject and predicate and obj:
            facts[subject][predicate].append(obj)
    return facts


def _facts_sentence(facts: dict[str, list[str]], skip: Iterable[str] = ()) -> str:
    skipped = set(skip)
    parts = []
    for predicate, objects in facts.items():
        if predicate in skipped or not objects:
            continue
        unique = list(dict.fromkeys(objects))[:8]
        parts.append(f"{predicate}：{'、'.join(unique)}")
        if len(parts) >= 12:
            break
    return "；".join(parts)


def _project_chunk(tier: str, project: dict, facts: dict[str, list[str]]) -> dict:
    title = _norm_text(project.get("title"))
    category = _norm_text(project.get("category"))
    if tier in ("head", "waist"):
        regions = _norm_text(project.get("regions"))
        region = regions
        lines = [
            f"《{title}》是{category}类非物质文化遗产项目"
            + (f"（编号 {project.get('num')}）" if project.get("num") else "")
            + f"，{_norm_text(project.get('announce_batch'))}{_norm_text(project.get('announce_year'))}公布"
            + (f"，申报地区：{regions}" if regions else "")
            + "。"
        ]
        if project.get("protect_unit"):
            lines.append(f"保护单位：{project['protect_unit']}。")
        entity_id = str(project.get("id") or title)
        source = _norm_text(project.get("source_url"))
    else:
        province = _norm_text(project.get("province"))
        region = "".join(part for part in (province, _norm_text(project.get("region"))) if part)
        lines = [
            f"《{title}》是{region}的{_norm_text(project.get('level')) or '省级'}{category}类非物质文化遗产项目，"
            f"{_norm_text(project.get('batch'))}{_norm_text(project.get('year'))}公布。"
        ]
        entity_id = title
        source = _norm_text(project.get("source_url"))
    fact_line = _facts_sentence(facts.get(title, {}), skip=("所属门类", "项目级别", "入选批次", "公布年份", "申报地区"))
    if fact_line:
        lines.append(f"档案事实：{fact_line}。")
    return {
        "kind": "project",
        "tier": tier,
        "entity_id": entity_id,
        "title": title,
        "category": category,
        "region": region,
        "source": source,
        "text": _clip("\n".join(lines), 1200),
    }


def _passage_chunks(tier: str, row: dict, project: dict | None) -> list[dict]:
    title = _norm_text(row.get("title"))
    category = _norm_text((project or {}).get("category"))
    region = _norm_text((project or {}).get("regions") or (project or {}).get("region"))
    if not category and isinstance(row.get("category"), str):
        category = row["category"]
    source = _norm_text(row.get("source_url"))
    entity_id = str(row.get("id") or (project or {}).get("id") or title)
    paragraphs = [str(item).strip() for item in (row.get("paragraphs") or []) if str(item).strip()]
    if not paragraphs and row.get("full_text"):
        paragraphs = [str(row["full_text"])]
    chunks = []
    prefix = f"《{title}》" + (f"（{category}，{region}）" if category or region else "")
    for index, paragraph in enumerate(paragraphs):
        if len(paragraph) < 12:
            continue
        chunks.append(
            {
                "kind": "passage",
                "tier": tier,
                "entity_id": entity_id,
                "title": title,
                "category": category,
                "region": region,
                "source": source,
                "text": _clip(f"{prefix}\n{paragraph}", 1200),
            }
        )
    return chunks


def _inheritor_chunks(tier: str, row: dict) -> list[dict]:
    name = _norm_text(row.get("name"))
    project = _norm_text(row.get("project"))
    category = _norm_text(row.get("category"))
    region = _norm_text(row.get("region"))
    province = _norm_text(row.get("province"))
    if province and not region.startswith(province):
        region = province + region
    batch = _norm_text(row.get("batch"))
    year = _norm_text(row.get("year") or row.get("batch_year"))
    source = _norm_text(row.get("source_url") or row.get("source"))
    if tier in ("head", "waist"):
        head = (
            f"{name}，{_norm_text(row.get('sex'))}，{_norm_text(row.get('nation'))}，"
            f"{_norm_text(row.get('birth'))}年生，是{batch}国家级非物质文化遗产项目《{project}》的代表性传承人"
            f"（{region}）。"
        )
    else:
        head = f"{name}，{region}人，是{batch}{year}年{category}类非物质文化遗产项目《{project}》的省级代表性传承人。"
    chunks = [
        {
            "kind": "inheritor",
            "tier": tier,
            "entity_id": f"inheritor-{tier}-{name}-{project}",
            "title": f"{name}（{project}传承人）",
            "category": category,
            "region": region,
            "source": source,
            "text": _clip(head, 1200),
        }
    ]
    bio = _norm_text(row.get("bio"))
    for index in range(0, min(len(bio), 1200), 500):
        part = bio[index : index + 500].strip()
        if len(part) >= 20:
            chunks.append(
                {
                    "kind": "inheritor",
                    "tier": tier,
                    "entity_id": f"inheritor-{tier}-{name}-{project}",
                    "title": f"{name}（{project}传承人）",
                    "category": category,
                    "region": region,
                    "source": source,
                    "text": _clip(f"{name}（《{project}》传承人）\n{part}", 1200),
                }
            )
    return chunks


def rebuild_index(
    asset_root: Path | None = None,
    target: Path | None = None,
    progress: Callable[[str], None] | None = None,
) -> dict:
    """从 asset/ 重建索引（原子替换）。返回统计信息。"""
    global _state
    asset_root = asset_root or asset_dir()
    target = target or db_path()
    if not asset_root.exists():
        raise FileNotFoundError(f"资料目录不存在：{asset_root}")
    with _lock:
        if _state["building"]:
            raise RuntimeError("索引正在构建中")
        _state["building"] = True
        _state["last_error"] = ""
    started = time.time()
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_suffix(".tmp.db")
    if temp.exists():
        temp.unlink()
    counts = defaultdict(int)
    titles: set[tuple[str, str, str, str, str]] = set()
    region_entries: set[tuple[str, str]] = set()
    try:
        conn = sqlite3.connect(str(temp), timeout=60)
        conn.execute("PRAGMA journal_mode=DELETE")
        conn.execute("PRAGMA synchronous=OFF")
        conn.executescript(
            """
            CREATE TABLE chunks (
                id INTEGER PRIMARY KEY,
                kind TEXT NOT NULL,
                tier TEXT NOT NULL,
                entity_id TEXT NOT NULL,
                title TEXT NOT NULL,
                category TEXT,
                region TEXT,
                source TEXT,
                text TEXT NOT NULL
            );
            CREATE INDEX idx_chunks_entity ON chunks(entity_id);
            CREATE INDEX idx_chunks_tier ON chunks(tier);
            CREATE INDEX idx_chunks_title ON chunks(title);
            CREATE VIRTUAL TABLE chunks_fts USING fts5(
                title, text, content='chunks', content_rowid='id', tokenize='trigram'
            );
            CREATE TABLE titles (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL, tier TEXT NOT NULL, entity_id TEXT NOT NULL,
                category TEXT, region TEXT
            );
            CREATE TABLE regions (
                id INTEGER PRIMARY KEY,
                short TEXT NOT NULL, region TEXT NOT NULL
            );
            CREATE INDEX idx_regions_short ON regions(short);
            CREATE VIRTUAL TABLE titles_fts USING fts5(bigrams, content='', tokenize='unicode61');
            CREATE TABLE rag_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            """
        )
        chunk_id = 0
        batch: list[tuple] = []

        def flush() -> None:
            nonlocal batch
            if not batch:
                return
            conn.executemany(
                "INSERT INTO chunks(kind,tier,entity_id,title,category,region,source,text) VALUES (?,?,?,?,?,?,?,?)",
                batch,
            )
            batch = []

        def add_chunk(chunk: dict) -> None:
            nonlocal chunk_id
            chunk_id += 1
            counts[chunk["kind"]] += 1
            counts[f"tier:{chunk['tier']}"] += 1
            batch.append(
                (
                    chunk["kind"],
                    chunk["tier"],
                    chunk["entity_id"],
                    chunk["title"],
                    chunk["category"],
                    chunk["region"],
                    chunk["source"],
                    chunk["text"],
                )
            )
            titles.add(
                (chunk["title"], chunk["tier"], chunk["entity_id"], chunk["category"], chunk["region"])
            )
            for short in _region_shorts(chunk.get("region") or ""):
                region_entries.add((short, chunk["region"]))
            if len(batch) >= 500:
                flush()

        for tier in TIERS:
            tier_root = asset_root / tier
            if not tier_root.exists():
                continue
            if progress:
                progress(f"读取 {tier} …")
            projects = [
                row
                for row in iter_jsonl(tier_root / "projects" / f"{tier}_projects.jsonl")
                if row.get("title")
            ]
            projects_by_id = {str(row.get("id")): row for row in projects if row.get("id")}
            projects_by_title = {_norm_text(row.get("title")): row for row in projects}
            facts = _load_triples(tier_root / "triples" / f"{tier}_triples.jsonl")
            inheritor_facts = _load_triples(
                tier_root / "inheritors" / f"{tier}_inheritor_triples.jsonl"
            )
            for title, extra in inheritor_facts.items():
                for predicate, objects in extra.items():
                    facts.setdefault(title, {})[predicate] = objects

            for project in projects:
                add_chunk(_project_chunk(tier, project, facts))
            flush()
            if progress:
                progress(f"{tier} 项目 {len(projects)} 条已入库")

            passage_path = tier_root / "passages" / f"{tier}_passages.jsonl"
            passage_count = 0
            if passage_path.exists():
                for row in iter_jsonl(passage_path):
                    project = projects_by_id.get(str(row.get("id"))) or projects_by_title.get(
                        _norm_text(row.get("title"))
                    )
                    for chunk in _passage_chunks(tier, row, project):
                        add_chunk(chunk)
                        passage_count += 1
            flush()
            if progress:
                progress(f"{tier} 正文 {passage_count} 段已入库")

            inheritor_path = tier_root / "inheritors" / f"{tier}_inheritors.jsonl"
            inheritor_count = 0
            if inheritor_path.exists():
                for row in iter_jsonl(inheritor_path):
                    for chunk in _inheritor_chunks(tier, row):
                        add_chunk(chunk)
                        inheritor_count += 1
            flush()
            if progress:
                progress(f"{tier} 传承人 {inheritor_count} 条已入库")

        if progress:
            progress("建立全文索引 …")
        conn.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')")
        title_rows = []
        for index, (title, title_tier, entity_id, title_category, title_region) in enumerate(
            sorted(titles), start=1
        ):
            title_rows.append((index, title, title_tier, entity_id, title_category, title_region))
        conn.executemany(
            "INSERT INTO titles(id,title,tier,entity_id,category,region) VALUES (?,?,?,?,?,?)",
            title_rows,
        )
        conn.executemany(
            "INSERT INTO titles_fts(rowid,bigrams) VALUES (?,?)",
            [(row[0], " ".join(_bigrams(row[1]))) for row in title_rows if row[1]],
        )
        conn.executemany(
            "INSERT INTO regions(short,region) VALUES (?,?)",
            sorted(region_entries),
        )

        signature = asset_signature(asset_root)
        meta = {
            "built_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "asset_signature": signature,
            "asset_bytes": str(sum(path.stat().st_size for path in _jsonl_files(asset_root))),
            "chunks": str(chunk_id),
            "projects": str(counts.get("project", 0)),
            "passages": str(counts.get("passage", 0)),
            "inheritors": str(counts.get("inheritor", 0)),
            "titles": str(len(titles)),
            "elapsed": f"{time.time() - started:.1f}",
        }
        conn.executemany(
            "INSERT INTO rag_meta(key,value) VALUES (?,?)", [(key, value) for key, value in meta.items()]
        )
        conn.commit()
        conn.execute("PRAGMA optimize")
        conn.close()
        os.replace(temp, target)
        for suffix in ("-wal", "-shm"):
            stale = target.with_name(target.name + suffix)
            if stale.exists():
                stale.unlink()
        stats = {
            **meta,
            "asset_dir": str(asset_root),
            "db": str(target),
            "size_bytes": target.stat().st_size,
        }
        _state["last_build"] = time.time()
        if progress:
            progress(
                f"完成：{stats['chunks']} 块（项目 {stats['projects']} / 正文 {stats['passages']} / "
                f"传承人 {stats['inheritors']}），耗时 {stats['elapsed']}s，{stats['size_bytes'] / 1e6:.1f} MB"
            )
        return stats
    except Exception as error:  # noqa: BLE001
        _state["last_error"] = str(error)
        if temp.exists():
            temp.unlink()
        raise
    finally:
        with _lock:
            _state["building"] = False


_REGION_RE = re.compile(r"[\u4e00-\u9fff]{2,10}?(?:省|自治区|市|自治州|地区|盟|县|区)")


def _region_shorts(region: str) -> list[str]:
    """把「贵州省台江县」拆成「贵州」「台江」，供「苏州/洛阳」这类城市级提问加权。"""
    text = str(region or "").strip()
    shorts: list[str] = []
    for token in _REGION_RE.findall(text):
        for suffix in ("自治州", "自治区", "地区", "省", "市", "盟", "县", "区"):
            if token.endswith(suffix) and len(token) > len(suffix) + 1:
                token = token[: -len(suffix)]
                break
        if 2 <= len(token) <= 8:
            shorts.append(token)
    if not shorts and 2 <= len(text) <= 8:
        shorts.append(text)
    return shorts


def _bigrams(text: str) -> list[str]:
    clean = re.sub(r"\s+", "", str(text or ""))
    return [clean[index : index + 2] for index in range(max(0, len(clean) - 1))]


def _index_ready() -> bool:
    path = db_path()
    if not path.exists():
        return False
    try:
        with _connect(path) as conn:
            meta = _read_meta(conn)
        return bool(meta.get("chunks")) and meta.get("asset_signature") == asset_signature()
    except sqlite3.Error:
        return False


def ensure_index(background: bool = False) -> bool:
    """确保索引可用；缺失/过期时重建（或后台重建）。"""
    if _index_ready():
        return True
    if _state["building"]:
        return False
    if background:
        threading.Thread(target=_background_rebuild, daemon=True).start()
        return False
    try:
        rebuild_index()
        return True
    except Exception as error:  # noqa: BLE001
        _state["last_error"] = str(error)
        print(f"[rag] 索引构建失败：{error}")
        return False


def _background_rebuild() -> None:
    try:
        rebuild_index(progress=lambda message: print(f"[rag] {message}"))
    except Exception as error:  # noqa: BLE001
        print(f"[rag] 后台构建失败：{error}")


def warmup() -> None:
    """应用启动时调用：索引缺失或过期就在后台重建，不阻塞启动。"""
    settings = get_settings()
    if not getattr(settings, "rag_enabled", True):
        return
    if not asset_dir().exists():
        return
    if not _index_ready():
        threading.Thread(target=_background_rebuild, daemon=True).start()


# ── 检索 ─────────────────────────────────────────────────────


def _query_terms(query: str) -> list[str]:
    text = str(query or "").strip()
    if not text:
        return []
    expanded = text + " " + " ".join(value for key, value in SYNONYMS.items() if key in text)
    for word in STOPWORDS:
        expanded = expanded.replace(word, " ")
    segments = re.findall(r"[\u4e00-\u9fffA-Za-z0-9]+", expanded)
    terms: list[str] = []
    for segment in segments:
        segment = segment.strip().strip(EDGE_CHARS)
        if len(segment) < 2:
            continue
        if len(segment) <= 6:
            terms.append(segment)
        # 无论长短都补 2 字词，便于「贵州刺绣」这种没有空格的组合
        for index in range(0, len(segment) - 1):
            terms.append(segment[index : index + 2])
    unique: list[str] = []
    for term in terms:
        if term in STOPWORDS or term in unique:
            continue
        unique.append(term)
    # 长词优先，最多保留 MAX_TERMS 个
    unique.sort(key=len, reverse=True)
    return unique[:MAX_TERMS]


def _like_pattern(term: str) -> str:
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _title_candidates(conn: sqlite3.Connection, terms: list[str]) -> dict[str, float]:
    """用标题的 bigram 索引找实体：哪些项目/传承人标题包含查询词。"""
    scores: dict[str, float] = defaultdict(float)
    for term in terms:
        grams = _bigrams(term)
        if not grams:
            continue
        match = " AND ".join(f'"{gram}"' for gram in grams[:4])
        try:
            rows = conn.execute(
                "SELECT c.title, c.tier, c.category, c.region FROM titles_fts f "
                "JOIN titles c ON c.id = f.rowid WHERE titles_fts MATCH ? LIMIT 40",
                (match,),
            ).fetchall()
        except sqlite3.Error:
            continue
        for row in rows:
            key = (row["title"], row["tier"])
            scores[key] += 4.0 + len(term)
    return scores


def _regions_in_query(conn: sqlite3.Connection, query: str) -> list[str]:
    text = str(query or "").strip()
    if len(text) < 2:
        return []
    try:
        rows = conn.execute(
            "SELECT DISTINCT short FROM regions WHERE length(short) >= 2 AND instr(?, short) > 0 "
            "ORDER BY length(short) DESC LIMIT 8",
            (text,),
        ).fetchall()
    except sqlite3.Error:
        return []
    return [row["short"] for row in rows]


def _titles_in_query(conn: sqlite3.Connection, query: str, tier: str | None = None) -> set[tuple[str, str]]:
    """找出「完整出现在提问里」的实体标题，这是最强的检索信号。"""
    text = str(query or "").strip()
    if len(text) < 2:
        return set()
    params: list = [text]
    extra = ""
    if tier:
        extra = " AND tier = ?"
        params.append(tier)
    try:
        rows = conn.execute(
            f"SELECT DISTINCT title, tier FROM titles WHERE length(title) >= 2 "
            f"AND instr(?, title) > 0{extra} ORDER BY length(title) DESC LIMIT 24",
            params,
        ).fetchall()
    except sqlite3.Error:
        return set()
    return {(row["title"], row["tier"]) for row in rows}


def search(
    query: str,
    top_k: int = 6,
    tier: str | None = None,
    category: str | None = None,
    min_score: float = 0.0,
    region_weight: float = 8.0,
) -> list[RagHit]:
    settings = get_settings()
    if not getattr(settings, "rag_enabled", True):
        return []
    terms = _query_terms(query)
    if not terms:
        return []
    if not ensure_index(background=False):
        return []
    path = db_path()
    filters = []
    params_common: list = []
    if tier:
        filters.append("c.tier = ?")
        params_common.append(tier)
    if category:
        filters.append("c.category = ?")
        params_common.append(category)
    where = (" AND " + " AND ".join(filters)) if filters else ""
    scores: dict[int, float] = defaultdict(float)
    with _connect(path) as conn:
        title_matches = _titles_in_query(conn, query, tier)
        region_matches = _regions_in_query(conn, query)
        title_scores = _title_candidates(conn, terms)
        for term in terms:
            if len(term) >= 3:
                try:
                    rows = conn.execute(
                        f"SELECT c.id, bm25(chunks_fts, 4.0, 1.0) AS rank FROM chunks_fts f "
                        f"JOIN chunks c ON c.id = f.rowid WHERE chunks_fts MATCH ?{where} LIMIT 80",
                        (f'"{term}"', *params_common),
                    ).fetchall()
                except sqlite3.Error:
                    rows = []
                for row in rows:
                    scores[row["id"]] += max(0.3, -float(row["rank"]))
        # 短词（或长词没有命中）用 LIKE 兜底，只取前 120 条
        for term in terms:
            if len(term) > 2:
                continue
            try:
                rows = conn.execute(
                    f"SELECT c.id FROM chunks c WHERE (c.title LIKE ? ESCAPE '\\' OR c.text LIKE ? ESCAPE '\\'){where} "
                    f"ORDER BY CASE c.kind WHEN 'project' THEN 0 WHEN 'passage' THEN 1 ELSE 2 END LIMIT 160",
                    (_like_pattern(term), _like_pattern(term), *params_common),
                ).fetchall()
            except sqlite3.Error:
                rows = []
            for row in rows:
                scores[row["id"]] += 1.2
        if not scores:
            for term in terms[:4]:
                try:
                    rows = conn.execute(
                        f"SELECT c.id FROM chunks c WHERE c.text LIKE ? ESCAPE '\\'{where} "
                        f"ORDER BY CASE c.kind WHEN 'project' THEN 0 WHEN 'passage' THEN 1 ELSE 2 END LIMIT 120",
                        (_like_pattern(term), *params_common),
                    ).fetchall()
                except sqlite3.Error:
                    rows = []
                for row in rows:
                    scores[row["id"]] += 0.8
        # 标题候选（子串命中）直接给对应实体的卡片与正文加分
        for (title, tier_key), value in title_scores.items():
            try:
                rows = conn.execute(
                    f"SELECT c.id FROM chunks c WHERE c.title = ? AND c.tier = ?{where} LIMIT 6",
                    (title, tier_key, *params_common),
                ).fetchall()
            except sqlite3.Error:
                rows = []
            for row in rows:
                scores[row["id"]] += value * 0.6
        # 完整标题出现在提问里：强加分
        for title, tier_key in title_matches:
            try:
                rows = conn.execute(
                    f"SELECT c.id FROM chunks c WHERE c.title = ? AND c.tier = ?{where} LIMIT 8",
                    (title, tier_key, *params_common),
                ).fetchall()
            except sqlite3.Error:
                rows = []
            for row in rows:
                scores[row["id"]] += 12.0
        # 地区命中的条目直接拉进候选池，避免被大量同门类项目挤出（城市对话尤其需要）
        if region_matches and region_weight > 0:
            for short in region_matches:
                try:
                    rows = conn.execute(
                        f"SELECT c.id FROM chunks c WHERE c.region LIKE ? ESCAPE '\\'{where} "
                        f"ORDER BY CASE c.kind WHEN 'project' THEN 0 WHEN 'passage' THEN 1 ELSE 2 END LIMIT 160",
                        (f"%{short}%", *params_common),
                    ).fetchall()
                except sqlite3.Error:
                    rows = []
                for row in rows:
                    scores[row["id"]] += 6.0
        if not scores:
            return []
        pool = sorted(scores.items(), key=lambda item: item[1], reverse=True)[: max(top_k * 25, 160)]
        ids = [chunk_id for chunk_id, _ in pool]
        placeholders = ",".join("?" for _ in ids)
        rows = {
            row["id"]: row
            for row in conn.execute(f"SELECT * FROM chunks WHERE id IN ({placeholders})", ids).fetchall()
        }

    category_focus = next((item for item in CATEGORIES if item in query), None) or category
    province_focus = next((item for item in PROVINCES if item in query), None)
    asks_inheritor = any(word in query for word in ("传承人", "传人", "谁", "艺人", "师父", "师傅"))
    asks_project = any(word in query for word in ("项目", "名录", "哪些", "哪个"))
    kind_bonus = {"project": 2.4, "passage": 2.0, "inheritor": 0.2}
    scored = []
    for chunk_id, raw in pool:
        row = rows.get(chunk_id)
        if row is None:
            continue
        score = float(raw)
        kind = row["kind"]
        score += kind_bonus.get(kind, 0.0)
        if asks_inheritor and kind == "inheritor":
            score += 4.0
        if asks_project and kind == "project":
            score += 2.5
        if category_focus and row["category"] == category_focus:
            score += 8.0
        if province_focus and province_focus in (row["region"] or ""):
            score += 4.0
        if region_matches and region_weight > 0:
            if any(short in (row["region"] or "") for short in region_matches):
                score += region_weight
            else:
                score -= 3.0
        if (row["title"], row["tier"]) in title_matches:
            score += {"project": 14.0, "passage": 10.0, "inheritor": 5.0}.get(kind, 4.0)
        if score < min_score and (row["title"], row["tier"]) not in title_matches:
            continue
        scored.append((score, row))
    scored.sort(key=lambda item: item[0], reverse=True)

    hits: list[RagHit] = []
    per_title: dict[str, int] = defaultdict(int)
    per_kind_title: dict[tuple[str, str], int] = defaultdict(int)
    per_entity: dict[str, int] = defaultdict(int)
    seen_text: set[str] = set()
    kind_cap = {"project": 1, "passage": 2, "inheritor": 1}
    for score, row in scored:
        # 同一实体：项目卡 1 张 + 正文最多 2 段 + 传承人 1 条，正文负责讲内容
        if per_title[row["title"]] >= 3:
            continue
        if per_kind_title[(row["title"], row["kind"])] >= kind_cap.get(row["kind"], 1):
            continue
        entity = f"{row['kind']}:{row['entity_id']}"
        if per_entity[entity] >= 2:
            continue
        fingerprint = row["text"][:120]
        if fingerprint in seen_text:
            continue
        seen_text.add(fingerprint)
        per_title[row["title"]] += 1
        per_kind_title[(row["title"], row["kind"])] += 1
        per_entity[entity] += 1
        hits.append(
            RagHit(
                chunk_id=row["id"],
                kind=row["kind"],
                tier=row["tier"],
                entity_id=row["entity_id"],
                title=row["title"],
                category=row["category"] or "",
                region=row["region"] or "",
                source=row["source"] or "",
                text=row["text"],
                score=round(float(score), 3),
            )
        )
        if len(hits) >= top_k:
            break
    return hits


def _title_candidates_safe(path: Path, terms: list[str]) -> dict[str, float]:
    try:
        with _connect(path) as conn:
            return _title_candidates(conn, terms)
    except sqlite3.Error:
        return {}


def build_context(hits: list[RagHit], max_chars: int = 2600) -> str:
    if not hits:
        return ""
    blocks = []
    used = 0
    for index, hit in enumerate(hits, 1):
        body = _clip(hit.text, 520)
        head = f"[{index}] 《{hit.title}》｜{TIER_LABEL.get(hit.tier, hit.tier)}"
        if hit.category:
            head += f"｜{hit.category}"
        if hit.region:
            head += f"｜{hit.region}"
        block = f"{head}\n{body}"
        if used + len(block) > max_chars:
            break
        blocks.append(block)
        used += len(block)
    return "\n\n".join(blocks)


def sources_payload(hits: list[RagHit]) -> list[dict]:
    payload = []
    for index, hit in enumerate(hits, 1):
        payload.append(
            {
                "index": index,
                "title": hit.title,
                "tier": hit.tier,
                "tier_label": TIER_LABEL.get(hit.tier, hit.tier),
                "category": hit.category,
                "region": hit.region,
                "snippet": _clip(hit.text, 160),
                "source": hit.source,
                "score": hit.score,
            }
        )
    return payload


def status() -> dict:
    path = db_path()
    if not path.exists():
        return {
            "ready": False,
            "building": _state["building"],
            "last_error": _state["last_error"],
            "db": str(path),
            "asset_dir": str(asset_dir()),
        }
    try:
        with _connect(path) as conn:
            meta = _read_meta(conn)
            counts = {
                "chunks": _table_count(conn, "chunks"),
                "projects": conn.execute("SELECT COUNT(*) FROM chunks WHERE kind='project'").fetchone()[0],
                "passages": conn.execute("SELECT COUNT(*) FROM chunks WHERE kind='passage'").fetchone()[0],
                "inheritors": conn.execute(
                    "SELECT COUNT(*) FROM chunks WHERE kind='inheritor'"
                ).fetchone()[0],
                "titles": _table_count(conn, "titles"),
            }
            tiers = {
                row[0]: row[1]
                for row in conn.execute("SELECT tier, COUNT(*) FROM chunks GROUP BY tier").fetchall()
            }
    except sqlite3.Error as error:
        return {"ready": False, "building": _state["building"], "last_error": str(error), "db": str(path)}
    return {
        "ready": True,
        "building": _state["building"],
        "stale": meta.get("asset_signature") != asset_signature(),
        "last_error": _state["last_error"],
        "db": str(path),
        "size_bytes": path.stat().st_size,
        "built_at": meta.get("built_at", ""),
        "elapsed": meta.get("elapsed", ""),
        "asset_dir": str(asset_dir()),
        "asset_bytes": int(meta.get("asset_bytes") or 0),
        "counts": counts,
        "tiers": tiers,
    }
