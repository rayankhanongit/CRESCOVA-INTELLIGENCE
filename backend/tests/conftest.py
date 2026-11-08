import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp(prefix="crescova-test-", dir=os.environ.get("TEST_TMP")))
os.environ["DATABASE_URL"] = f"sqlite:///{(_tmp / 'test.db').as_posix()}"
os.environ["SECRET_KEY"] = "test-secret-key-not-for-production-use-0123456789"
os.environ["ALLOW_REGISTRATION"] = "true"
os.environ["CRAWL_DELAY_SECONDS"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import models  # noqa: E402,F401
from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.security import login_limiter, register_limiter  # noqa: E402
from app.seo import ssrf  # noqa: E402

from fakesite import FakeFetcher, good_site  # noqa: E402

H = {"X-Requested-With": "crescova"}
_REAL_RESOLVE = ssrf.resolve_public_sync


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from app.ai import service as ai_service
    ai_service.reset_limiter()
    login_limiter.reset()
    register_limiter.reset()
    # Tests never touch the network: DNS says everything is a public address, fetching is faked.
    monkeypatch.setattr(ssrf, "resolve_public_sync", lambda host, port: ["93.184.216.34"])
    app.state.fetcher_factory = lambda: FakeFetcher(good_site())
    yield


@pytest.fixture
def real_dns(monkeypatch):
    """Use the real resolver logic (socket.getaddrinfo is stubbed per test)."""
    monkeypatch.setattr(ssrf, "resolve_public_sync", _REAL_RESOLVE)


@pytest.fixture
def client():
    with TestClient(app, headers=H) as c:
        yield c


def register(client, email="owner@example.com", org="Acme Agency"):
    r = client.post("/api/auth/register", json={"email": email, "password": "correct-horse-battery", "full_name": "Owner", "organisation_name": org})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def authed(client):
    register(client)
    return client
