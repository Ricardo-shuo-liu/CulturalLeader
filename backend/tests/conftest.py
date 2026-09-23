"""测试环境：独立 SQLite 文件 + 强制 Mock，避免污染开发库与外部接口。"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest

TEST_DB = Path(tempfile.gettempdir()) / "culturalleader_test.db"

os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["MOCK_MODE"] = "on"
os.environ["ADMIN_TOKEN"] = "test-token"
os.environ.pop("OPENAI_API_KEY", None)


@pytest.fixture(scope="session", autouse=True)
def fresh_database():
    if TEST_DB.exists():
        TEST_DB.unlink()
    yield
    if TEST_DB.exists():
        TEST_DB.unlink()
