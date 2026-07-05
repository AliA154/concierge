"""Reset the database to the sample tickets. Useful for a clean local demo."""

from app import seed_db

if __name__ == "__main__":
    seed_db(force=True)
    print("Database reset to sample tickets.")
