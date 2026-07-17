"""Concierge — a lightweight IT service desk console.

Flask app factory. The package splits cleanly: pure domain logic in sla.py,
SQLite plumbing in db.py, HTTP endpoints in routes.py, demo data in seed.py.
"""

from __future__ import annotations

import os
from pathlib import Path

from flask import Flask
from werkzeug.exceptions import HTTPException

ROOT = Path(__file__).resolve().parent.parent


def create_app(db_path: str | None = None, testing: bool = False) -> Flask:
    """Build the Flask app.

    The explicit db_path parameter wins over the CONCIERGE_DB env var, which
    wins over the default file next to the repo — so tests can never touch
    (or seed) a real database by accident.
    """
    from . import db as database
    from .routes import bp, error
    from .seed import seed_db

    app = Flask(
        __name__,
        template_folder=str(ROOT / "templates"),
        static_folder=str(ROOT / "static"),
    )
    app.config["TESTING"] = testing
    app.config["DATABASE"] = str(
        db_path or os.environ.get("CONCIERGE_DB") or ROOT / "concierge.db"
    )

    app.register_blueprint(bp)
    app.teardown_appcontext(database.close_db)

    @app.errorhandler(HTTPException)
    def handle_http_error(exc: HTTPException):
        # Every error — including Flask-level 404/405/500 — uses the same JSON
        # envelope, so clients never have to parse an HTML error page.
        return error(exc.code or 500, exc.name.lower())

    database.init_db(app.config["DATABASE"])
    if not app.config["TESTING"]:
        seed_db(app.config["DATABASE"])

    return app
