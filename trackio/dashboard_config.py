import copy
import math
from datetime import datetime, timezone

import orjson

from trackio.exceptions import TrackioAPIError


class ConfigConflict(TrackioAPIError):
    status_code = 409


def migrate(cursor):
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS dashboard_config_overrides (
        run_id TEXT PRIMARY KEY, overrides TEXT NOT NULL, revision INTEGER NOT NULL)"""
    )


def read_override(conn, run_id):
    try:
        row = conn.execute(
            "SELECT overrides, revision FROM dashboard_config_overrides WHERE run_id = ?",
            (run_id,),
        ).fetchone()
    except Exception as error:
        if "no such table" in str(error):
            return {}, 0
        raise
    return (orjson.loads(row[0]), row[1]) if row else ({}, 0)


def apply_overrides(config, overrides):
    result = copy.deepcopy(config or {})
    for encoded, value in overrides.items():
        path = orjson.loads(encoded)
        node = result
        for part in path[:-1]:
            if not isinstance(node.get(part), dict):
                node[part] = {}
            node = node[part]
        node[path[-1]] = value
    return result


def effective_config(conn, run_id, config):
    overrides, _ = read_override(conn, run_id)
    return apply_overrides(config, overrides)


def update_configs(project, targets, path, value):
    from trackio.sqlite_storage import SQLiteStorage

    if (
        not isinstance(path, list)
        or not path
        or any(not isinstance(part, str) or not part for part in path)
        or path[0].startswith("_")
    ):
        raise ValueError("Choose a non-reserved configuration path")
    if isinstance(value, (dict, list)) or (
        isinstance(value, float) and not math.isfinite(value)
    ):
        raise ValueError("Only finite scalar values are editable")
    if not targets:
        raise ValueError("Choose at least one run")
    db_path = SQLiteStorage.get_project_db_path(project)
    if not db_path.exists():
        raise ConfigConflict("Project no longer exists")
    encoded = orjson.dumps(path).decode()
    with SQLiteStorage._get_process_lock(project):
        with SQLiteStorage._get_connection(db_path) as conn:
            conn.execute("BEGIN IMMEDIATE")
            prepared = []
            known = {
                record["id"]
                for record in SQLiteStorage._query_run_records(conn, project)
            }
            if SQLiteStorage._table_columns(conn, "run_lifecycle"):
                known.update(
                    row[0] for row in conn.execute("SELECT run_id FROM run_lifecycle")
                )
            for target in targets:
                identity = SQLiteStorage._resolve_run_identity(
                    conn, run_name=target.get("run"), run_id=target.get("run_id")
                )
                if identity is None:
                    raise ConfigConflict("A selected run no longer exists")
                run_id = identity[1]
                if run_id not in known:
                    raise ConfigConflict("A selected run no longer exists")
                overrides, revision = read_override(conn, run_id)
                if target.get("revision") != revision:
                    raise ConfigConflict("Configuration changed; refresh and retry")
                column = (
                    "run_id"
                    if SQLiteStorage._supports_run_ids(conn, "configs")
                    else "run_name"
                )
                row = conn.execute(
                    f"SELECT config FROM configs WHERE {column} = ?", (run_id,)
                ).fetchone()
                if row is None:
                    now = datetime.now(timezone.utc).isoformat()
                    if column == "run_id":
                        conn.execute(
                            "INSERT INTO configs (run_id, run_name, config, created_at) VALUES (?, ?, ?, ?)",
                            (run_id, target.get("run") or run_id, "{}", now),
                        )
                    else:
                        conn.execute(
                            "INSERT INTO configs (run_name, config, created_at) VALUES (?, ?, ?)",
                            (run_id, "{}", now),
                        )
                config = effective_config(
                    conn, run_id, orjson.loads(row[0]) if row else {}
                )
                node = config
                for part in path[:-1]:
                    if part in node and not isinstance(node[part], dict):
                        raise ConfigConflict(
                            "A parent configuration field is not an object"
                        )
                    node = node.get(part, {})
                if isinstance(node.get(path[-1]), (dict, list)):
                    raise ValueError("Arrays and objects are read-only")
                for key in list(overrides):
                    other = orjson.loads(key)
                    if other[: len(path)] == path or path[: len(other)] == other:
                        del overrides[key]
                overrides[encoded] = value
                prepared.append((run_id, overrides, revision + 1))
            for run_id, overrides, revision in prepared:
                conn.execute(
                    "INSERT OR REPLACE INTO dashboard_config_overrides VALUES (?, ?, ?)",
                    (run_id, orjson.dumps(overrides), revision),
                )
            conn.commit()
    return {
        "configs": SQLiteStorage.get_all_run_configs(project),
        "revisions": revisions_for_project(project),
    }


def revisions_for_project(project):
    from trackio.sqlite_storage import SQLiteStorage

    db_path = SQLiteStorage.get_project_db_path(project)
    if not db_path.exists():
        return {}
    with SQLiteStorage._get_connection(db_path) as conn:
        try:
            return dict(
                conn.execute("SELECT run_id, revision FROM dashboard_config_overrides")
            )
        except Exception as error:
            if "no such table" in str(error):
                return {}
            raise
