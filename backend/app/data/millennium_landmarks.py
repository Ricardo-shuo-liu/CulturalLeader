"""地标建造年表：38 座有 3D 模型的城市地标，各自的「始建 / 重建 / 焚毁」史实阶段。

千年模式用它驱动"真实地标随史建造"：把地标模型按高度分件，在建造窗口里逐层立起来；
重建类地标会演「建 → 残迹 → 原址重建」，焚毁类（澳门大三巴）演到残迹为止。

约定：
- kind：wood 木构 / brick 砖石 / stone 石作 / rammed 夯土 / steel 钢构 / carve 开凿 /
        skyline 天际线（现代楼群渐次长高）/ nomad 游牧常在 / natural 自然常在；
- action：build 始建 / rebuild 重建 / burn 焚毁（只拆不建，留下残迹）；
- gap：这一段结束、下一段开始之前"空档期"的样子：ruins 残迹（毁后待重建，默认）/
       keep 依旧在场（迁建、扩建、天际线这类"楼没塌"的情况）；
- 年份取公开通说；少数条目（合肥砖城、银川清真寺明代始建、成都电视塔动工年）
  在 label 里注明「通说/往前推」。
"""

from __future__ import annotations

# key → {kind, phases: [(year, span, action, label), ...]}
LANDMARK_TIMELINES: dict[str, dict] = {
    # ── 种子五城 ──
    "tiantan": {"kind": "brick", "phases": [(1406, 14, "build", "明永乐十八年建成")]},
    "pearl": {"kind": "steel", "phases": [(1991, 4, "build", "1994 年建成")]},
    "canton_tower": {"kind": "steel", "phases": [(2005, 5, "build", "2010 年建成")]},
    "bell_tower": {
        "kind": "wood",
        # 1582 年是迁建（楼一直在），空档期用 keep
        "phases": [
            (1384, 1, "build", "明洪武十七年始建", "keep"),
            (1582, 1, "rebuild", "万历十年迁建今址", "keep"),
        ],
    },
    "panda_tower": {"kind": "steel", "phases": [(1989, 4, "build", "以 1992 年建成往前推")]},
    # ── 省级城市 ──
    "tianjin_eye": {"kind": "steel", "phases": [(2006, 3, "build", "2008 年建成")]},
    "chongqing_hongyadong": {"kind": "wood", "phases": [(2005, 2, "rebuild", "依吊脚楼旧制重建")]},
    "shijiazhuang_zhaozhou": {"kind": "stone", "phases": [(595, 10, "build", "隋大业年间李春造桥")]},
    "taiyuan_twin_pagoda": {"kind": "brick", "phases": [(1599, 9, "build", "明万历二十七年起建")]},
    "hohhot_yurt": {"kind": "nomad", "phases": []},
    "shenyang_palace": {"kind": "wood", "phases": [(1625, 11, "build", "1625 始建、1636 建成")]},
    "changchun_palace": {"kind": "brick", "phases": [(1932, 2, "build", "1932 年就任后扩建")]},
    "harbin_sophia": {
        "kind": "brick",
        "phases": [
            (1907, 3, "build", "1907 年初建", "keep"),
            (1932, 2, "rebuild", "1932 年重建为砖石结构", "keep"),
        ],
    },
    "nanjing_gate": {"kind": "brick", "phases": [(1366, 9, "build", "明洪武年间筑城，1375 年建成")]},
    "hangzhou_leifeng": {
        "kind": "brick",
        "phases": [(971, 6, "build", "吴越国始建，977 年建成"), (2002, 4, "rebuild", "2002 年原址重建")],
    },
    "hefei_gate": {"kind": "brick", "phases": [(1512, 4, "build", "明代砖城通说")]},
    "fuzhou_white_pagoda": {"kind": "brick", "phases": [(904, 5, "build", "唐天祐元年始建")]},
    "nanchang_tengwang": {
        "kind": "wood",
        "phases": [(653, 2, "build", "唐永徽四年始建"), (1983, 6, "rebuild", "1983 动工、1989 落成")],
    },
    "jinan_chaoran": {
        "kind": "wood",
        "phases": [(1324, 2, "build", "元代始建通说"), (2008, 3, "rebuild", "2008 年重建")],
    },
    "zhengzhou_erqi": {"kind": "brick", "phases": [(1971, 1, "build", "1971 年建成")]},
    "wuhan_yellow_crane": {
        "kind": "wood",
        "phases": [(223, 1, "build", "三国吴黄武二年始建"), (1981, 4, "rebuild", "1981 动工、1985 落成")],
    },
    "changsha_tianxin": {
        "kind": "wood",
        "phases": [(1746, 2, "build", "清乾隆十一年重修"), (1983, 3, "rebuild", "1983 年重建")],
    },
    "nanning_hall": {
        "kind": "skyline",
        "phases": [(1958, 20, "build", "现代城区起步", "keep"), (1995, 25, "rebuild", "高楼群渐次长高", "keep")],
    },
    "haikou_arcade": {"kind": "brick", "phases": [(1858, 20, "build", "开埠后骑楼陆续建成")]},
    "guiyang_jiaxiu": {
        "kind": "wood",
        "phases": [(1598, 2, "build", "明万历二十六年始建"), (1981, 2, "rebuild", "1981 年重建")],
    },
    "kunming_jinma": {
        "kind": "wood",
        "phases": [(1426, 3, "build", "明宣德年间通说"), (1998, 2, "rebuild", "1998 年原址重建")],
    },
    "lhasa_potala": {"kind": "brick", "phases": [(1645, 48, "build", "1645 年重建、1693 年基本建成")]},
    "lanzhou_bridge": {"kind": "steel", "phases": [(1906, 3, "build", "1906 开建、1909 建成")]},
    "xining_kumbum": {"kind": "wood", "phases": [(1379, 6, "build", "明洪武十二年建寺")]},
    "yinchuan_mosque": {
        "kind": "brick",
        "phases": [(1573, 20, "build", "明代始建通说"), (1981, 2, "rebuild", "1981 年重建")],
    },
    "urumqi_bazaar": {"kind": "steel", "phases": [(2002, 1, "build", "2003 年落成")]},
    "hongkong_skyline": {
        "kind": "skyline",
        "phases": [(1841, 30, "build", "开埠后的第一批楼群", "keep"), (1955, 55, "rebuild", "战后高楼群长高", "keep")],
    },
    "macau_ruins": {
        "kind": "stone",
        "phases": [(1602, 8, "build", "1602 年始建、1637 年落成"), (1835, 1, "burn", "1835 年大火，只留前壁")],
    },
    "taipei_101": {"kind": "steel", "phases": [(1998, 6, "build", "1998 动工、2004 建成")]},
    # ── 旅游名城 ──
    "luoyang_longmen": {"kind": "carve", "phases": [(493, 400, "build", "北魏迁洛后开凿，持续数百年")]},
    "dunhuang_mogao": {"kind": "carve", "phases": [(366, 600, "build", "366 年始凿，持续营造")]},
    "guilin_karst": {"kind": "natural", "phases": []},
    "suzhou_pagoda": {"kind": "brick", "phases": [(959, 2, "build", "959 始建、961 年建成")]},
}

VALID_KINDS = {"wood", "brick", "stone", "rammed", "steel", "carve", "skyline", "nomad", "natural"}
VALID_ACTIONS = {"build", "rebuild", "burn"}
VALID_GAPS = {"ruins", "keep"}

# 始终在场的类型：不演建造（自然景观 / 游牧场景）
ALWAYS_PRESENT = {"nomad", "natural"}


def landmark_timeline(key: str) -> dict | None:
    """返回某座地标的建造年表（含 kind 与阶段列表）；未收录返回 None。"""

    entry = LANDMARK_TIMELINES.get(str(key or "").strip())
    if not entry:
        return None
    phases = []
    for item in entry.get("phases") or []:
        year, span, action, label = item[0], item[1], item[2], item[3]
        gap = item[4] if len(item) > 4 else "ruins"
        phases.append(
            {"year": int(year), "span": int(span), "action": action, "label": label, "gap": gap}
        )
    kind = entry.get("kind") or "brick"
    return {
        "key": str(key).strip(),
        "kind": kind,
        "always": kind in ALWAYS_PRESENT,
        "phases": phases,
    }
