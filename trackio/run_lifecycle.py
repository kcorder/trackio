from datetime import datetime, timezone
from statistics import median

import orjson


def migrate(cursor):
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS run_lifecycle (
        run_id TEXT PRIMARY KEY, run_name TEXT NOT NULL,
        started_at TEXT NOT NULL, session_id TEXT NOT NULL, finished_at TEXT)"""
    )
    cursor.execute(
        """CREATE TABLE IF NOT EXISTS run_lifecycle_outbox (
        event_id TEXT PRIMARY KEY, destination TEXT NOT NULL, event TEXT NOT NULL)"""
    )


def accept_event(project, run, run_id, started_at, session_id, finished_at=None):
    from trackio.sqlite_storage import SQLiteStorage

    datetime.fromisoformat(started_at)
    if finished_at:
        datetime.fromisoformat(finished_at)
    db = SQLiteStorage.init_db(project)
    with SQLiteStorage._get_process_lock(project):
        with SQLiteStorage._get_connection(db) as conn:
            conn.execute(
                """INSERT INTO run_lifecycle VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET
                run_name=excluded.run_name, started_at=excluded.started_at,
                session_id=excluded.session_id,
                finished_at=CASE WHEN run_lifecycle.session_id=excluded.session_id
                THEN COALESCE(run_lifecycle.finished_at, excluded.finished_at)
                ELSE excluded.finished_at END
                WHERE (excluded.started_at, excluded.session_id) >=
                (run_lifecycle.started_at, run_lifecycle.session_id)""",
                (run_id, run, started_at, session_id, finished_at),
            )
            conn.commit()


def queue_event(project, destination, event):
    from trackio.sqlite_storage import SQLiteStorage

    db = SQLiteStorage.init_db(project)
    key = event["session_id"] + (":finish" if event.get("finished_at") else ":start")
    with SQLiteStorage._get_process_lock(project):
        with SQLiteStorage._get_connection(db) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO run_lifecycle_outbox VALUES (?, ?, ?)",
                (key, destination, orjson.dumps(event)),
            )
            conn.commit()


def pending_events(project, destination):
    from trackio.sqlite_storage import SQLiteStorage

    db = SQLiteStorage.init_db(project)
    with SQLiteStorage._get_connection(db) as conn:
        return [
            (row[0], orjson.loads(row[1]))
            for row in conn.execute(
                "SELECT event_id, event FROM run_lifecycle_outbox WHERE destination = ? ORDER BY json_extract(event, '$.started_at'), json_extract(event, '$.finished_at')",
                (destination,),
            )
        ]


def clear_event(project, event_id):
    from trackio.sqlite_storage import SQLiteStorage

    db = SQLiteStorage.get_project_db_path(project)
    with SQLiteStorage._get_process_lock(project):
        with SQLiteStorage._get_connection(db) as conn:
            conn.execute(
                "DELETE FROM run_lifecycle_outbox WHERE event_id = ?", (event_id,)
            )
            conn.commit()


def run_records(project, records):
    from trackio.sqlite_storage import SQLiteStorage

    db = SQLiteStorage.get_project_db_path(project)
    if not db.exists():
        return records
    now = datetime.now(timezone.utc).isoformat()
    with SQLiteStorage._get_connection(db) as conn:
        if not SQLiteStorage._table_columns(conn, "run_lifecycle"):
            return records
        lifecycle = {
            row["run_id"]: dict(row)
            for row in conn.execute("SELECT * FROM run_lifecycle")
        }
        records = [dict(record) for record in records]
        existing = {r["id"] for r in records}
        records.extend(
            {"id": key, "name": row["run_name"], "created_at": row["started_at"]}
            for key, row in lifecycle.items()
            if key not in existing
        )
        for record in records:
            row = lifecycle.get(record["id"])
            if not row:
                continue
            column = "run_id" if SQLiteStorage._supports_run_ids(conn) else "run_name"
            timestamps = [
                r[0]
                for r in conn.execute(
                    f"SELECT DISTINCT timestamp FROM metrics WHERE {column} = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT 21",
                    (record["id"], row["started_at"]),
                )
            ]
            times = sorted({datetime.fromisoformat(t).timestamp() for t in timestamps})
            gaps = [b - a for a, b in zip(times, times[1:]) if b > a]
            record["activity"] = {
                "state": "finished" if row["finished_at"] else "running",
                "last_log_at": timestamps[0] if timestamps else row["started_at"],
                "timeout_seconds": max(30, 5 * median(gaps)) if len(gaps) >= 2 else 900,
                "server_time": now,
            }
    return records
