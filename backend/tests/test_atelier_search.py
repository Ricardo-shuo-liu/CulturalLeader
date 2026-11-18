import asyncio

from backend.app.services.atelier.search import _parse_wikipedia, _search_titles, search_place


def test_search_titles_from_list_search_payload():
    payload = {"query": {"search": [{"title": "龙门石窟"}, {"title": "洛阳"}]}}
    assert _search_titles(payload) == ["龙门石窟", "洛阳"]


def test_parse_wikipedia_payload():
    payload = {
        "query": {
            "pages": {
                "1": {
                    "title": "龙门石窟",
                    "extract": "龙门石窟位于河南省洛阳市。",
                    "fullurl": "https://zh.wikipedia.org/wiki/龙门石窟",
                }
            }
        }
    }
    hits = _parse_wikipedia(payload)
    assert hits[0].title == "龙门石窟"
    assert hits[0].publisher == "维基百科"
    assert "洛阳" in hits[0].summary


def test_http_proxy_prefers_http_scheme(monkeypatch):
    from backend.app.services.atelier.search import http_proxy

    monkeypatch.setenv("ALL_PROXY", "socks://127.0.0.1:7897")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:7897")
    assert http_proxy() == "http://127.0.0.1:7897"


def test_search_failure_returns_empty(monkeypatch, tmp_path):
    import backend.app.services.atelier.search as search_module

    async def boom(*args, **kwargs):
        raise RuntimeError("blocked")

    monkeypatch.setattr(search_module, "_fetch_json", boom)
    monkeypatch.setattr(search_module, "CACHE_DIR", tmp_path)
    assert asyncio.run(search_place("龙门石窟")) == []
