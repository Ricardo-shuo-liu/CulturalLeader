from __future__ import annotations

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from .data.capitals import CAPITALS
from .models import City, Knowledge

SEED_CITIES: list[dict] = [
    {
        "slug": "beijing",
        "name": "北京",
        "province": "北京市",
        "lng": 116.4074,
        "lat": 39.9042,
        "accent_color": "#E8B44A",
        "landmark_key": "tiantan",
        "sort_order": 10,
        "tags": ["古都", "中轴线", "皇家园林"],
        "summary": "六朝古都，中轴线贯穿南北，是理解中国都城规划与礼制的一把钥匙。",
        "narration": (
            "欢迎来到北京。这座城市把七百年的都城秩序压缩在一条七点八公里的中轴线上："
            "南起永定门，向北穿过天坛与先农坛之间的空阔，跨过正阳门，进入紫禁城的重重门阙，"
            "最后停在钟鼓楼的晨钟暮鼓里。左边的祈年殿用三层蓝色琉璃檐模拟天穹，"
            "右边的宫城以黄瓦红墙对应大地，天与地就这样被一条线缝合在一起。"
        ),
        "knowledge": [
            ("祈年殿为什么是三重檐圆形建筑？", "三重檐圆攒尖顶对应“天圆”的宇宙观，蓝色琉璃瓦象征天空，殿内不用一根横梁，靠二十八根柱子的排布对应星宿与四季，是明代礼制建筑中形制最高的祈谷场所。"),
            ("中轴线有多长？", "传统中轴线南起永定门、北至钟鼓楼，约七点八公里；向北延伸至奥林匹克森林公园后，整体轴线长度约二十公里，是世界上最长的城市中轴线之一。"),
            ("什么时候来北京最舒服？", "九月到十月最好，秋高气爽、能见度高，红墙与银杏同时上色；春天多风沙，冬天则适合看雪后的宫城，人少且光线干净。"),
        ],
    },
    {
        "slug": "shanghai",
        "name": "上海",
        "province": "上海市",
        "lng": 121.4737,
        "lat": 31.2304,
        "accent_color": "#5AC8D8",
        "landmark_key": "pearl",
        "sort_order": 20,
        "tags": ["外滩", "石库门", "海派"],
        "summary": "江与海交汇处的近代都会，一边是万国建筑，一边是摩天森林。",
        "narration": (
            "欢迎来到上海。黄浦江在这里拐了一个弯，把城市切成两半：西岸的外滩是二十世纪初的"
            "万国建筑群，花岗岩与钟楼记录着开埠后的百年；东岸的陆家嘴则是三十年间长出的天际线，"
            "东方明珠的十一个球体从下往上串起这座城市对高度的想象。江面上货轮的汽笛与身后"
            "弄堂里的吴语，是同一座城市的两种语速。"
        ),
        "knowledge": [
            ("东方明珠为什么是球体结构？", "它由三个主要球体与十一颗小球组成，球体在结构上能承受风力并减少迎风面，塔高四百六十八米，一九九四年建成，是浦东开发开放最早的地标。"),
            ("外滩建筑群看什么？", "外滩一字排开二十多栋不同年代的建筑，从哥特式、新古典主义到装饰艺术风格，被称为“万国建筑博览”，其中海关大楼的钟声每小时会奏响《东方红》。"),
            ("石库门是什么？", "石库门是上海最有代表性的近代民居形式，用石条做门框、以天井组织通风采光，融合了江南民居与西式联排的布局，如今多改造为创意街区与博物馆。"),
        ],
    },
    {
        "slug": "guangzhou",
        "name": "广州",
        "province": "广东省",
        "lng": 113.2644,
        "lat": 23.1291,
        "accent_color": "#57C08A",
        "landmark_key": "canton_tower",
        "sort_order": 30,
        "tags": ["骑楼", "早茶", "珠江"],
        "summary": "两千年不衰的南方港城，骑楼、早茶与珠江夜色构成它的日常。",
        "narration": (
            "欢迎来到广州。珠江水从城中穿过，把一千八百年的商港记忆留在两岸："
            "从秦汉的蕃禺到清代的十三行，这座城市一直在做同一件事——迎接远方来的人。"
            "广州塔用一圈扭转的钢架把这种柔韧写进了高度，四百五十四米的腰身在夜里会亮起"
            "不断变化的彩衣，而楼下茶楼里的一盅两件，才是这座城市真正的呼吸节奏。"
        ),
        "knowledge": [
            ("广州塔为什么是扭转的形状？", "塔身由两个椭圆面旋转咬合形成双曲面结构，中段最细、上下渐宽，这种形状既减少风荷载又形成独特造型，塔身四百五十四米，加天线总高六百米。"),
            ("早茶有什么讲究？", "广州早茶讲究“一盅两件”，即一壶茶配两样点心；虾饺、干蒸烧卖、叉烧包、蛋挞被称为四大天王，茶楼从清晨五点营业到午市，是社交与谈生意的重要场所。"),
            ("十三行是什么？", "清代广州一口通商时期，十三行是官方特许经营对外贸易的商行群体，负责与欧美商人交易茶叶、丝绸与瓷器，是当时中国最重要的对外窗口。"),
        ],
    },
    {
        "slug": "xian",
        "name": "西安",
        "province": "陕西省",
        "lng": 108.9398,
        "lat": 34.3416,
        "accent_color": "#D98A5A",
        "landmark_key": "bell_tower",
        "sort_order": 40,
        "tags": ["城墙", "唐风", "丝路起点"],
        "summary": "十三朝古都，城墙围出一座方城，钟楼是它的几何中心。",
        "narration": (
            "欢迎来到西安。城墙把老城围成一个规整的矩形，钟楼正落在四条大街的交点上，"
            "明代的重檐三滴水在夜里亮起暖黄，像一枚压在城图中央的印章。"
            "从这里向南是大雁塔，向西是丝路的起点，脚下这片土地曾叫长安，"
            "接待过从西域一路而来的商队、僧人与乐师。"
        ),
        "knowledge": [
            ("钟楼为什么建在路中间？", "钟楼始建于明洪武年间，最初位于西大街，万历年间整体迁到四条大街交汇处，成为城市的几何中心；楼上曾悬大钟用于报时，与鼓楼相对构成晨钟暮鼓。"),
            ("西安城墙可以骑车吗？", "可以。城墙全长约十三点七公里，顶部宽阔平整，租一辆自行车环城约需一到两小时，是俯瞰老城与护城河最好的方式。"),
            ("兵马俑离市区远吗？", "兵马俑位于临潼，距市区约四十公里，开车约一小时；建议与华清宫同日游览，先看一号坑的军阵全貌，再进二三号坑看指挥部与精锐部队。"),
        ],
    },
    {
        "slug": "chengdu",
        "name": "成都",
        "province": "四川省",
        "lng": 104.0665,
        "lat": 30.5723,
        "accent_color": "#9E8CD8",
        "landmark_key": "panda_tower",
        "sort_order": 50,
        "tags": ["盖碗茶", "熊猫", "平原"],
        "summary": "被龙门山与龙泉山环抱的平原之城，慢节奏里藏着两千年的水利智慧。",
        "narration": (
            "欢迎来到成都。成都平原是群山之间的一块平地，都江堰用鱼嘴、飞沙堰与宝瓶口"
            "三件朴素的水工，把岷江分成灌溉与排洪两路，让这里两千多年不涝不旱。"
            "天府熊猫塔立在锦江边，十四颗球体沿塔身升起，像一根被点亮的竹节；"
            "而城市真正的节奏，在人民公园竹椅上那碗可以续一整天的盖碗茶里。"
        ),
        "knowledge": [
            ("都江堰为什么两千年还在用？", "它顺应水势而非对抗水势：鱼嘴分水按四六比例调节内外江，飞沙堰在洪水期自动泄洪排沙，宝瓶口控制入渠水量，整套系统不用一处大坝即可长期运行。"),
            ("天府熊猫塔有什么特点？", "塔高三百三十九米，塔身沿高度分布多颗球体，顶部可俯瞰成都平原；因造型被市民称为“玉米塔”，是成都广播电视发射与观光一体的地标。"),
            ("盖碗茶怎么喝？", "盖碗由茶盖、茶碗、茶船三部分组成，揭盖可以闻香、刮沫、撇茶，老茶客习惯用盖子斜搭在碗沿示意续水，一坐就是半天。"),
        ],
    },
]


def sync_capitals(db: Session) -> int:
    """补齐省会 / 自治区首府 / 直辖市 / 特别行政区的城市资料（幂等）。

    只补数据库里还没有的城市，已存在的内容（例如北京、上海这些更详细的讲解）不会被覆盖。
    返回新增数量。
    """
    added = 0
    for index, item in enumerate(CAPITALS):
        if db.scalar(select(City).where(City.slug == item["slug"])) is not None:
            continue
        city = City(
            slug=item["slug"],
            name=item["name"],
            province=item["province"],
            lng=item["lng"],
            lat=item["lat"],
            accent_color=item["accent_color"],
            summary=item["summary"],
            tags=json.dumps(item["tags"], ensure_ascii=False),
            landmark_key=item["landmark_key"],
            narration=item["narration"],
            sort_order=100 + index * 10,
        )
        city.knowledge = [Knowledge(question=q, answer=a) for q, a in item["knowledge"]]
        db.add(city)
        added += 1
    if added:
        db.commit()
    return added


def seed_if_empty(db: Session) -> None:
    if db.scalar(select(City).limit(1)) is not None:
        return

    for item in SEED_CITIES:
        city = City(
            slug=item["slug"],
            name=item["name"],
            province=item["province"],
            lng=item["lng"],
            lat=item["lat"],
            accent_color=item["accent_color"],
            summary=item["summary"],
            tags=json.dumps(item["tags"], ensure_ascii=False),
            landmark_key=item["landmark_key"],
            narration=item["narration"],
            sort_order=item["sort_order"],
        )
        city.knowledge = [Knowledge(question=q, answer=a) for q, a in item["knowledge"]]
        db.add(city)

    db.commit()
