import asyncio

from backend.app.services.atelier.renderer import draw_scene, make_postcard, to_2x
from backend.app.services.atelier.scene_spec import build_rule_scene


def _collect(prompt, seed=41):
    from backend.app.services.atelier.pipeline import stream_generation

    async def run():
        return [event async for event in stream_generation(prompt, seed=seed)]

    return asyncio.run(run())


def _no_search(monkeypatch):
    async def fake_search(*args, **kwargs):
        return []

    monkeypatch.setattr("backend.app.services.atelier.pipeline.search_place", fake_search)


def test_save_job_writes_files_and_zip(tmp_path, monkeypatch):
    from backend.app.services.atelier import storage

    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    spec = build_rule_scene("洛阳龙门石窟，黄昏", seed=22)
    scene = draw_scene(spec)
    artifacts = storage.save_job(spec, scene, to_2x(scene), make_postcard(scene, spec))
    assert artifacts.scene.exists()
    assert artifacts.scene_2x.exists()
    assert artifacts.postcard.exists()
    assert artifacts.spec_json.exists()
    assert artifacts.zip.exists()


def test_event_sequence_and_files(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    _no_search(monkeypatch)
    events = _collect("洛阳龙门石窟，黄昏")
    event_names = [event.event for event in events]
    assert event_names[0] == "stage"
    assert "source" in event_names or "stage" in event_names
    assert event_names[-1] == "done"
    done = events[-1].data
    assert done["job_id"]
    assert (tmp_path / done["job_id"] / "scene.png").exists()
    assert (tmp_path / done["job_id"] / "scene.zip").exists()
    stages = {event.data["key"]: event.data for event in events if event.event == "stage"}
    assert stages["skill"]["status"] == "done"
    assert stages["validate"]["status"] == "done"


def test_search_query_is_concise(tmp_path, monkeypatch):
    seen = {}

    async def spy(query, **kwargs):
        seen["query"] = query
        return []

    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    monkeypatch.setattr("backend.app.services.atelier.pipeline.search_place", spy)
    _collect("洛阳龙门石窟，黄昏，伊水与崖壁大佛")
    assert seen["query"] == "洛阳 龙门石窟"


def test_relevant_hits_drop_off_topic_sources():
    from backend.app.services.atelier.pipeline import _relevant_hits
    from backend.app.services.atelier.search import SearchHit

    hits = [
        SearchHit(title="洛阳市", url="a", summary="洛阳"),
        SearchHit(title="麦积山石窟", url="b", summary="天水"),
        SearchHit(title="龙门石窟", url="c", summary="洛阳"),
    ]
    filtered = _relevant_hits(hits, "洛阳", "龙门石窟")
    assert [hit.title for hit in filtered] == ["洛阳市", "龙门石窟"]


def test_render_error_yields_error_without_job(tmp_path, monkeypatch):
    from backend.app.services.atelier import pipeline

    monkeypatch.setattr("backend.app.services.atelier.storage.ATELIER_DIR", tmp_path)
    _no_search(monkeypatch)
    monkeypatch.setattr(pipeline, "draw_scene", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    events = _collect("洛阳龙门石窟，黄昏")
    assert events[-1].event == "error"
    assert "boom" in events[-1].data["message"]
    assert list(tmp_path.iterdir()) == []
