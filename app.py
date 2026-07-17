"""Thin entry-point shim so `gunicorn app:app` and `python app.py` both work.

All real code lives in the `concierge` package (see concierge/__init__.py).
"""

import os

from concierge import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(debug=True, host="0.0.0.0", port=port)
