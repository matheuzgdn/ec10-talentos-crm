"""Apply one trusted SQL migration using a dotenv profile without printing secrets."""
from __future__ import annotations

import argparse
from pathlib import Path

import psycopg
from dotenv import dotenv_values


parser = argparse.ArgumentParser()
parser.add_argument("sql_file")
parser.add_argument("--env", default="/home/opc/ec10-gustavo-v2/.env")
args = parser.parse_args()

database_url = dotenv_values(args.env).get("DATABASE_URL")
if not database_url:
    raise SystemExit("DATABASE_URL is not configured")
sql = Path(args.sql_file).read_text(encoding="utf-8")
with psycopg.connect(database_url, prepare_threshold=None, autocommit=True) as connection:
    connection.execute(sql)
print(f"applied:{Path(args.sql_file).name}")
