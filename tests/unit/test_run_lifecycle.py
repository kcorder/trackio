import pytest

import trackio.server as server
from trackio.exceptions import TrackioAPIError
from trackio.run_lifecycle import accept_event, run_records
from trackio.sqlite_storage import SQLiteStorage


def test_lifecycle_is_idempotent_and_old_sessions_cannot_finish_new_ones(temp_dir):
    common = {"project": "p", "run": "r", "run_id": "id"}
    accept_event(**common, started_at="2026-01-01T00:00:00+00:00", session_id="a")
    accept_event(
        **common,
        started_at="2026-01-01T00:00:00+00:00",
        session_id="a",
        finished_at="2026-01-01T00:01:00+00:00",
    )
    accept_event(**common, started_at="2026-01-01T00:00:00+00:00", session_id="a")
    assert run_records("p", [])[0]["activity"]["state"] == "finished"
    accept_event(**common, started_at="2026-01-02T00:00:00+00:00", session_id="b")
    accept_event(
        **common,
        started_at="2026-01-01T00:00:00+00:00",
        session_id="a",
        finished_at="2026-01-03T00:00:00+00:00",
    )
    assert run_records("p", [])[0]["activity"]["state"] == "running"


def test_cadence_uses_distinct_user_logs_not_system_logging(temp_dir):
    accept_event("p", "r", "id", "2026-01-01T00:00:00+00:00", "session")
    assert run_records("p", [])[0]["activity"]["timeout_seconds"] == 900
    SQLiteStorage.bulk_log(
        "p",
        "r",
        [{"x": 1}] * 3,
        timestamps=[
            "2026-01-01T00:00:00+00:00",
            "2026-01-01T00:01:00+00:00",
            "2026-01-01T00:02:00+00:00",
        ],
        run_id="id",
    )
    SQLiteStorage.bulk_log_system(
        "p", "r", [{"cpu": 1}], timestamps=["2026-01-01T00:03:00+00:00"], run_id="id"
    )
    activity = run_records("p", [])[0]["activity"]
    assert activity["timeout_seconds"] == 300
    assert activity["last_log_at"] == "2026-01-01T00:02:00+00:00"


def test_lifecycle_write_api_uses_logging_permissions(temp_dir, monkeypatch):
    def deny(request, token):
        raise TrackioAPIError("denied")

    monkeypatch.setattr(server, "assert_can_write_metrics", deny)
    with pytest.raises(TrackioAPIError, match="denied"):
        server.update_run_lifecycle(
            None, "p", "r", "id", "2026-01-01T00:00:00+00:00", "session"
        )
    assert run_records("p", []) == []
