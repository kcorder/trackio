from concurrent.futures import ThreadPoolExecutor

import orjson
import pytest

from trackio.dashboard_config import ConfigConflict, update_configs
from trackio.sqlite_storage import SQLiteStorage


def target(run_id, revision=0):
    return {"run_id": run_id, "run": "same", "revision": revision}


def seed(run_id):
    SQLiteStorage.bulk_log(
        "p", "same", [{"loss": 1}], run_id=run_id, config={"args": {"lr": 1}}
    )


def test_manual_config_survives_upload_and_conflicting_bulk_is_atomic(temp_dir):
    seed("a")
    seed("b")
    update_configs("p", [target("a")], ["args", "lr"], 2)
    seed("a")
    assert SQLiteStorage.get_run_config("p", "same", run_id="a")["args"]["lr"] == 2
    with pytest.raises(ConfigConflict):
        update_configs("p", [target("b"), target("a")], ["args", "lr"], 3)
    assert SQLiteStorage.get_run_config("p", "same", run_id="b")["args"]["lr"] == 1


def test_manual_config_moves_and_is_deleted_with_run(temp_dir):
    seed("a")
    update_configs("p", [target("a")], ["label"], "edited")
    assert SQLiteStorage.move_run("p", "same", "other", run_id="a")
    assert (
        SQLiteStorage.get_run_config("other", "same", run_id="a")["label"] == "edited"
    )
    assert SQLiteStorage.delete_run("other", "same", run_id="a")


def test_invalid_config_edits_do_not_write(temp_dir):
    seed("a")
    for path, value in [
        (["_Created"], "bad"),
        (["args"], []),
        (["args", "lr", "child"], 1),
    ]:
        with pytest.raises((ValueError, ConfigConflict)):
            update_configs("p", [target("a")], path, value)


def test_editing_a_run_without_original_config_and_missing_targets(temp_dir):
    SQLiteStorage.bulk_log("p", "same", [{"loss": 1}], run_id="a")
    result = update_configs("p", [target("a")], ["experiment_name"], "organized")
    assert result["configs"]["a"]["experiment_name"] == "organized"
    with pytest.raises(ConfigConflict):
        update_configs("p", [target("missing")], ["experiment_name"], "lost")


def test_concurrent_editors_cannot_silently_overwrite_each_other(temp_dir):
    seed("a")

    def edit(value):
        try:
            update_configs("p", [target("a")], ["label"], value)
            return True
        except ConfigConflict:
            return False

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(edit, ["first", "second"]))
    assert sorted(outcomes) == [False, True]


def test_export_uses_effective_config_and_keeps_override_metadata(temp_dir):
    seed("a")
    update_configs("p", [target("a")], ["label"], "edited")
    rows = SQLiteStorage._read_table_rows(
        SQLiteStorage.get_project_db_path("p"), "configs"
    )
    assert orjson.loads(rows[0]["config"])["label"] == "edited"
    overrides = SQLiteStorage._read_table_rows(
        SQLiteStorage.get_project_db_path("p"), "dashboard_config_overrides"
    )
    assert overrides[0]["revision"] == 1
