"""Manage dashboard accounts from the command line.

  python scripts/manage_users.py add <username> --role admin|viewer [--name "Full name"]
  python scripts/manage_users.py list
  python scripts/manage_users.py passwd <username>
  python scripts/manage_users.py role <username> admin|viewer
  python scripts/manage_users.py remove <username>

Passwords are asked for interactively and stored only as salted hashes in data/users.json.
Set ATLAS_DATA_DIR if your data folder is somewhere else.
"""
import argparse
import getpass
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.auth import Auth, AuthError  # noqa: E402


def ask_password() -> str:
    pw = getpass.getpass("Password: ")
    if getpass.getpass("Repeat password: ") != pw:
        sys.exit("Passwords did not match.")
    return pw


def main() -> None:
    p = argparse.ArgumentParser(description="Manage Urban Atlas accounts")
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("add"); a.add_argument("username"); a.add_argument("--role", default="viewer", choices=["viewer", "admin"]); a.add_argument("--name", default="")
    sub.add_parser("list")
    pw = sub.add_parser("passwd"); pw.add_argument("username")
    r = sub.add_parser("role"); r.add_argument("username"); r.add_argument("role", choices=["viewer", "admin"])
    rm = sub.add_parser("remove"); rm.add_argument("username")
    args = p.parse_args()
    auth = Auth(Path(os.getenv("ATLAS_DATA_DIR", ROOT / "data")))
    try:
        if args.cmd == "add":
            u = auth.add_user(args.username, ask_password(), args.role, args.name)
            print(f"Added {u.username} ({u.role}).")
        elif args.cmd == "list":
            for u in auth.list_users():
                print(f"{u['username']:<20} {u['role']:<7} {u['name']}")
        elif args.cmd == "passwd":
            auth.update_user(args.username.lower(), password=ask_password()); print("Password changed.")
        elif args.cmd == "role":
            auth.update_user(args.username.lower(), role=args.role); print(f"{args.username} is now {args.role}.")
        elif args.cmd == "remove":
            auth.delete_user(args.username.lower()); print(f"Removed {args.username}.")
    except AuthError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
