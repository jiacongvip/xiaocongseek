"""Controlled offline entry. Does NOT import vendor, Playwright, requests, conf, or account runtime.
No production execution implemented; --execute always fails closed. Never pass credentials here.
"""
import argparse
import json
import re
import sys
from pathlib import Path


def validate(payload):
    required = {"schemaVersion", "spaceId", "taskId", "packId", "packRevision", "platform", "bindingId", "snapshotFingerprint"}
    if not isinstance(payload, dict) or set(payload) != required:
        raise ValueError("Execution manifest accepts reference IDs only; no paths, URLs, credentials, or content overrides")
    if type(payload["schemaVersion"]) is not int or payload["schemaVersion"] != 1 or type(payload["packRevision"]) is not int or payload["packRevision"] < 1:
        raise ValueError("Invalid execution manifest version")
    patterns = {"spaceId": r"[A-Za-z0-9][A-Za-z0-9_-]{0,47}", "taskId": r"task-[a-f0-9]{32}", "packId": r"pack-[a-f0-9]{32}", "bindingId": r"binding-[a-f0-9-]{36}", "snapshotFingerprint": r"[a-f0-9]{64}"}
    for key, pattern in patterns.items():
        if not isinstance(payload[key], str) or not re.fullmatch(pattern, payload[key]):
            raise ValueError("Invalid " + key)
    platforms = json.loads((Path(__file__).parent / "platforms.json").read_text(encoding="utf-8"))
    if payload["platform"] not in {p["key"] for p in platforms if p["kind"] == "publisher-adapter"}:
        raise ValueError("Not a preserved publisher platform")
    return payload


def main():
    parser = argparse.ArgumentParser(description="Disabled-by-default GEO publishing boundary")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true")
    group.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    try:
        raw = sys.stdin.read(32769)
        if len(raw) > 32768:
            raise ValueError("Execution manifest too large")
        manifest = validate(json.loads(raw))
        result = {"success": bool(args.dry_run), "mode": "dry-run" if args.dry_run else "blocked", "taskId": manifest["taskId"], "validated": True, "executed": False, "externalCalls": 0, "accountAccess": False, "mediaRead": False, "reasons": ["Production executor disabled", "Legal GEO authorization/capability/quota adapter and independent credential provider not configured", "No vendor import or browser/network execution in this entry"]}
        print(json.dumps(result))
        return 0 if args.dry_run else 3
    except (ValueError, TypeError, KeyError) as error:
        print(json.dumps({"success": False, "mode": "rejected", "error": str(error), "executed": False, "externalCalls": 0}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
