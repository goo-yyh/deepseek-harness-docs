#!/usr/bin/env python3

from __future__ import annotations

import argparse
import contextlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts/snapshot_manager.py"
SPEC = importlib.util.spec_from_file_location("dsh_snapshot_manager", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def write(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value)


def record(path: Path, root: Path) -> dict[str, object]:
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": module.sha256_file(path),
        "git_blob": module.git_blob_hash(path),
        "bytes": path.stat().st_size,
    }


def pair_fixture(root: Path) -> dict[str, object]:
    english = root / "docs/guide.md"
    chinese = root / "docs/guide.zh.md"
    meta = root / "docs/guide.i18n.yaml"
    write(english, "# Guide\n\nEnglish | [中文](guide.zh.md)\n")
    write(chinese, "# 指南\n\n[English](guide.md) | 中文\n")
    write(
        meta,
        f"guide.md: {module.git_blob_hash(english)}\n"
        f"guide.zh.md: {module.git_blob_hash(chinese)}\n",
    )
    return {"english": english, "chinese": chinese, "meta": meta}


class ClassificationTests(unittest.TestCase):
    def fixture(self) -> tuple[Path, dict[str, object], tempfile.TemporaryDirectory[str]]:
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name)
        control = root / "website/docs.ts"
        write(control, "export const pages = []\n")
        pair = pair_fixture(root)
        lock = {
            "controls": [record(control, root)],
            "published_sources": [
                record(pair["english"], root),
                record(pair["chinese"], root),
            ],
            "pairing_records": [record(pair["meta"], root)],
        }
        return root, lock, temporary

    def test_noop_snapshot_has_no_changes(self) -> None:
        root, lock, temporary = self.fixture()
        self.addCleanup(temporary.cleanup)
        result = module.classify_checkout(root, lock)
        self.assertEqual(result["control_changes"], [])
        self.assertEqual(result["source_changes"], [])
        self.assertEqual(result["blockers"], [])

    def test_incremental_pair_update_is_actionable(self) -> None:
        root, lock, temporary = self.fixture()
        self.addCleanup(temporary.cleanup)
        english = root / "docs/guide.md"
        chinese = root / "docs/guide.zh.md"
        write(english, english.read_text() + "\nNew paragraph.\n")
        write(chinese, chinese.read_text() + "\n新增段落。\n")
        write(
            root / "docs/guide.i18n.yaml",
            f"guide.md: {module.git_blob_hash(english)}\n"
            f"guide.zh.md: {module.git_blob_hash(chinese)}\n",
        )
        result = module.classify_checkout(root, lock)
        self.assertEqual(len(result["source_changes"]), 2)
        self.assertEqual(result["blockers"], [])

    def test_catalog_change_blocks(self) -> None:
        root, lock, temporary = self.fixture()
        self.addCleanup(temporary.cleanup)
        write(root / "website/docs.ts", "export const pages = ['new']\n")
        result = module.classify_checkout(root, lock)
        self.assertEqual(result["blockers"][0]["kind"], "control_changed")

    def test_pair_mismatch_blocks(self) -> None:
        root, lock, temporary = self.fixture()
        self.addCleanup(temporary.cleanup)
        write(root / "docs/guide.zh.md", "# 未确认的改动\n")
        result = module.classify_checkout(root, lock)
        self.assertTrue(any(item["kind"] == "pair_invalid" for item in result["blockers"]))


class ImmutableRunTests(unittest.TestCase):
    def test_recovery_reuses_frozen_checkout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            mirror = base / "mirror"
            upstream = base / "upstream"
            write(mirror / "config/upstream-lock.json", json.dumps({"commit": "0" * 40}))
            write(mirror / "config/docs-manifest.json", json.dumps({"pages": []}))
            upstream.mkdir()
            subprocess.run(["git", "init", "-q", upstream], check=True)
            subprocess.run(["git", "-C", upstream, "config", "user.name", "Test"], check=True)
            subprocess.run(["git", "-C", upstream, "config", "user.email", "test@example.com"], check=True)
            write(upstream / "docs/a.md", "frozen\n")
            subprocess.run(["git", "-C", upstream, "add", "."], check=True)
            subprocess.run(["git", "-C", upstream, "commit", "-qm", "fixture"], check=True)
            first = argparse.Namespace(
                repo_root=str(mirror),
                run_id="2026-08-16-source",
                recovery_run_id=None,
                upstream_path=str(upstream),
                allow_test_upstream=True,
            )
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(module.command_prepare(first), 0)
            second = argparse.Namespace(
                repo_root=str(mirror),
                run_id="2026-08-16-recovery",
                recovery_run_id="2026-08-16-source",
                upstream_path=None,
                allow_test_upstream=True,
            )
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(module.command_prepare(second), 0)
            recovered = mirror / ".docs-source/runs/2026-08-16-recovery/checkout/docs/a.md"
            self.assertEqual(recovered.read_text(), "frozen\n")
            metadata = json.loads(
                (mirror / ".docs-source/runs/2026-08-16-recovery/run.json").read_text()
            )
            self.assertEqual(metadata["recovery"]["source_run_id"], "2026-08-16-source")

    def test_result_requires_passed_verification(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            write(root / "config/upstream-lock.json", json.dumps({"commit": "0" * 40}))
            run = root / ".docs-source/runs/2026-08-16-blocked"
            write(run / "verification.json", json.dumps({"status": "blocked"}))
            write(run / "reports/discovery.json", json.dumps({"status": "ready"}))
            args = argparse.Namespace(repo_root=str(root), run_id="2026-08-16-blocked")
            with self.assertRaises(module.SyncError):
                module.command_result(args)


if __name__ == "__main__":
    unittest.main(verbosity=2)
