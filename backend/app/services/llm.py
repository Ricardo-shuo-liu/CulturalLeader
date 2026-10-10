from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Sequence

from ..config import get_settings
from ..models import City, Knowledge

SYSTEM_TEMPLATE = """你是「{name}」的文旅数字人讲解员，站在舞台幕布前为观众讲解这座城市。

城市资料
- 城市：{name}（{province}）
- 简介：{summary}
- 关键词：{tags}

讲解词参考
{narration}

可回答的知识条目
{knowledge}

要求：
1. 用中文口语化表达，像面对面讲解，不要使用 Markdown 标题与列表。
2. 每次回答控制在 2 到 4 句，适合被朗读；句子之间用中文标点。
3. 只使用上面提供的资料，不确定的内容要坦率说明并引导观众换个话题。
4. 不要重复观众的原话，不要提及“知识库”“资料”这类词。"""


def build_system_prompt(city: City, knowledge: Sequence[Knowledge]) -> str:
    knowledge_text = "\n".join(f"- 问：{item.question}\n  答：{item.answer}" for item in knowledge) or "- 暂无"
    return SYSTEM_TEMPLATE.format(
        name=city.name,
        province=city.province or "中国",
        summary=city.summary or "暂无简介",
        tags="、".join(city.tag_list) or "暂无",
        narration=city.narration or "暂无",
        knowledge=knowledge_text,
    )


def _score(question: str, item: Knowledge) -> int:
    text = question.replace(" ", "")
    score = 0
    for token in set(item.question.replace("？", "").replace("，", "")):
        if token in text:
            score += 1
    for token in item.answer[:24]:
        if token in text:
            score += 1
    return score


def pick_knowledge(question: str, knowledge: Sequence[Knowledge]) -> Knowledge | None:
    if not knowledge:
        return None
    ranked = sorted(knowledge, key=lambda item: _score(question, item), reverse=True)
    best = ranked[0]
    return best if _score(question, best) >= 2 else None


def mock_answer(city: City, knowledge: Sequence[Knowledge], question: str) -> str:
    text = question.strip()
    if not text:
        return city.narration or f"欢迎来到{city.name}。"

    if any(word in text for word in ("你好", "介绍", "讲讲", "说说", "概况", "是什么城市")):
        return city.narration or f"欢迎来到{city.name}。"

    matched = pick_knowledge(text, knowledge)
    if matched is not None:
        return matched.answer

    topics = "、".join(item.question.rstrip("？") for item in knowledge[:3])
    ending = f"你还可以问我：{topics}。" if topics else ""
    return f"{city.summary} 关于这个细节我这边还没有确切资料，不想凭空编造。{ending}（当前为本地 Mock 讲解，配置 OPENAI_API_KEY 后可自由问答。）"


async def stream_reply(
    city: City,
    knowledge: Sequence[Knowledge],
    history: Sequence[tuple[str, str]],
    question: str,
    *,
    system_prompt: str | None = None,
    allow_mock: bool = True,
) -> AsyncIterator[str]:
    """逐段产出回复文本。无 Key 时使用本地知识库拼装，行为对外一致。

    system_prompt 用于穿越系统等自定义人格场景；传入时优先使用，city 仅作为兜底资料。
    allow_mock=False 时跳过本地知识库（穿越对话按约定只走大模型）。
    """

    settings = get_settings()
    if allow_mock and settings.mock:
        answer = mock_answer(city, knowledge, question)
        step = 3
        for index in range(0, len(answer), step):
            yield answer[index : index + step]
            await asyncio.sleep(0.02)
        return

    from openai import AsyncOpenAI

    client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.base_url)
    messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt or build_system_prompt(city, knowledge)}
    ]
    for role, content in history[-6:]:
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": question})

    stream = await client.chat.completions.create(
        model=settings.chat_model,
        messages=messages,
        stream=True,
        temperature=0.7,
    )
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
