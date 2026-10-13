import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="chatflow-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["UPLOAD_DIR"] = f"{_tmp}/uploads"
os.environ["SECRET_KEY"] = "test-secret-test-secret-test-secret"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture()
def client():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with TestClient(app) as c:
        yield c


def make_user(client, name):
    r = client.post("/auth/register", json={"username": name, "email": f"{name}@example.com", "password": "password123"})
    assert r.status_code == 201, r.text
    d = r.json()
    return {"id": d["user"]["id"], "h": {"Authorization": f"Bearer {d['access_token']}"}, "token": d["access_token"]}


@pytest.fixture()
def alice(client):
    return make_user(client, "alice")


@pytest.fixture()
def bob(client):
    return make_user(client, "bob")


@pytest.fixture()
def carol(client):
    return make_user(client, "carol")
