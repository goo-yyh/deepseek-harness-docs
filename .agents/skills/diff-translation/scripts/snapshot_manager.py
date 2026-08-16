#!/usr/bin/env python3
"""Immutable GitHub-source synchronization for the DeepSeek Harness docs mirror."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


UPSTREAM_URL = "https://github.com/deepseek-ai/deepseek-harness.git"
UPSTREAM_BRANCH = "master"
RUN_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{2,119}$")
ADAPTED_CONTROLS = {"scripts/project-doc-site.ts"}
EXCLUDED_FINGERPRINT_PARTS = {
    ".git",
    ".docs-source",
    ".vercel",
    "node_modules",
    ".dist",
    ".cache",
    ".generated",
    ".design-evidence",
    ".chat",
}


class SyncError(RuntimeError):
    """A fail-closed synchronization error."""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def git_blob_hash(path: Path) -> str:
    data = path.read_bytes()
    digest = hashlib.sha1()
    digest.update(f"blob {len(data)}\0".encode())
    digest.update(data)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        raise SyncError(f"cannot read JSON {path}: {error}") from error
    if not isinstance(value, dict):
        raise SyncError(f"JSON root must be an object: {path}")
    return value


def write_json_atomic(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    temporary.replace(path)


def write_text_atomic(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temporary.write_text(value)
    temporary.replace(path)


def run_command(
    command: list[str], cwd: Path, *, check: bool = True, capture: bool = True
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        command,
        cwd=cwd,
        check=False,
        text=True,
        capture_output=capture,
    )
    if check and result.returncode != 0:
        detail = (result.stderr or result.stdout or "no output").strip()
        raise SyncError(f"command failed ({result.returncode}): {' '.join(command)}\n{detail}")
    return result


def git(cwd: Path, *args: str) -> str:
    return run_command(["git", "-C", str(cwd), *args], cwd).stdout.strip()


def normalize_remote(value: str) -> str:
    value = re.sub(r"^git@github\.com:", "https://github.com/", value.strip())
    return value.removesuffix(".git").rstrip("/")


def validate_run_id(run_id: str) -> None:
    if RUN_ID_RE.fullmatch(run_id) is None:
        raise SyncError("run ID must be 3-120 safe filename characters")


def repository_root(value: str) -> Path:
    root = Path(value).resolve()
    if not (root / "config/upstream-lock.json").is_file():
        raise SyncError(f"not a DeepSeek Harness docs mirror: {root}")
    return root


def runs_root(root: Path) -> Path:
    return root / ".docs-source/runs"


def resolve_run(root: Path, requested: str | None) -> tuple[str, Path]:
    run_id = requested
    if run_id is None:
        current = read_json(root / ".docs-source/current.json")
        current_id = current.get("run_id")
        if not isinstance(current_id, str):
            raise SyncError("current run pointer has no run_id")
        run_id = current_id
    validate_run_id(run_id)
    run = runs_root(root) / run_id
    if not run.is_dir():
        raise SyncError(f"run does not exist: {run_id}")
    return run_id, run


def remote_head(root: Path) -> str:
    result = run_command(
        ["git", "ls-remote", UPSTREAM_URL, f"refs/heads/{UPSTREAM_BRANCH}"], root
    ).stdout.strip()
    match = re.fullmatch(r"([0-9a-f]{40})\s+refs/heads/master", result)
    if match is None:
        raise SyncError(f"unexpected ls-remote response: {result!r}")
    return match.group(1)


def command_check(args: argparse.Namespace) -> int:
    root = repository_root(args.repo_root)
    lock = read_json(root / "config/upstream-lock.json")
    locked = lock.get("commit")
    current = remote_head(root)
    status = "no_update" if current == locked else "sync_required"
    result = {
        "schema_version": 1,
        "status": status,
        "repository": UPSTREAM_URL.removesuffix(".git"),
        "branch": UPSTREAM_BRANCH,
        "locked_commit": locked,
        "upstream_commit": current,
        "checked_at": utc_now(),
    }
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.require_update and status == "no_update":
        return 20
    return 0


def validate_official_checkout(checkout: Path, allow_test_upstream: bool = False) -> str:
    if not (checkout / ".git").exists():
        raise SyncError(f"upstream checkout is not a Git repository: {checkout}")
    if not allow_test_upstream:
        remote = normalize_remote(git(checkout, "remote", "get-url", "origin"))
        if remote != normalize_remote(UPSTREAM_URL):
            raise SyncError(f"refusing non-official upstream remote: {remote}")
    commit = git(checkout, "rev-parse", "HEAD")
    if re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        raise SyncError("upstream checkout did not resolve to a full commit")
    return commit


def clone_upstream(destination: Path, root: Path) -> None:
    run_command(
        [
            "git",
            "clone",
            "--depth",
            "1",
            "--filter=blob:none",
            "--branch",
            UPSTREAM_BRANCH,
            UPSTREAM_URL,
            str(destination),
        ],
        root,
    )


def command_prepare(args: argparse.Namespace) -> int:
    root = repository_root(args.repo_root)
    validate_run_id(args.run_id)
    run = runs_root(root) / args.run_id
    if run.exists():
        raise SyncError(f"immutable run already exists: {args.run_id}")
    run.mkdir(parents=True)
    checkout = run / "checkout"
    created_at = utc_now()
    try:
        if args.recovery_run_id:
            validate_run_id(args.recovery_run_id)
            source_run = runs_root(root) / args.recovery_run_id
            source_checkout = source_run / "checkout"
            if not source_checkout.is_dir():
                raise SyncError("recovery source run has no frozen checkout")
            shutil.copytree(source_checkout, checkout, symlinks=True)
            recovery = {
                "source_run_id": args.recovery_run_id,
                "source_run_sha256": sha256_file(source_run / "run.json"),
            }
        elif args.upstream_path:
            source = Path(args.upstream_path).resolve()
            validate_official_checkout(source, args.allow_test_upstream)
            shutil.copytree(source, checkout, symlinks=True, ignore=shutil.ignore_patterns("node_modules"))
            recovery = None
        else:
            clone_upstream(checkout, root)
            recovery = None

        commit = validate_official_checkout(checkout, args.allow_test_upstream)
        lock = read_json(root / "config/upstream-lock.json")
        manifest = read_json(root / "config/docs-manifest.json")
        metadata = {
            "schema_version": 1,
            "run_id": args.run_id,
            "created_at": created_at,
            "repository": UPSTREAM_URL.removesuffix(".git"),
            "branch": UPSTREAM_BRANCH,
            "upstream_commit": commit,
            "upstream_tree": git(checkout, "rev-parse", "HEAD^{tree}"),
            "baseline_commit": lock.get("commit"),
            "baseline_lock_sha256": sha256_file(root / "config/upstream-lock.json"),
            "baseline_manifest_sha256": sha256_file(root / "config/docs-manifest.json"),
            "recovery": recovery,
        }
        write_json_atomic(run / "baseline/upstream-lock.json", lock)
        write_json_atomic(run / "baseline/docs-manifest.json", manifest)
        write_json_atomic(run / "run.json", metadata)
        write_json_atomic(
            root / ".docs-source/current.json",
            {"schema_version": 1, "run_id": args.run_id, "updated_at": utc_now()},
        )
        print(json.dumps(metadata, ensure_ascii=False, indent=2))
        return 0
    except Exception:
        shutil.rmtree(run, ignore_errors=True)
        raise


def compare_locked_file(checkout: Path, record: dict[str, Any]) -> str:
    relative_path = record.get("path")
    expected = record.get("sha256")
    if not isinstance(relative_path, str) or not isinstance(expected, str):
        raise SyncError("invalid locked file record")
    path = checkout / relative_path
    if not path.is_file():
        return "missing"
    return "unchanged" if sha256_file(path) == expected else "changed"


def validate_pair_records(checkout: Path, records: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    for record in records:
        relative_path = record.get("path")
        if not isinstance(relative_path, str) or not relative_path.endswith(".i18n.yaml"):
            errors.append("invalid pairing record path")
            continue
        meta = checkout / relative_path
        if not meta.is_file():
            errors.append(f"missing pairing record {relative_path}")
            continue
        base = relative_path.removesuffix(".i18n.yaml")
        owners = [f"{base}.md", f"{base}.zh.md"]
        text = meta.read_text()
        for owner in owners:
            owner_path = checkout / owner
            if not owner_path.is_file():
                errors.append(f"missing pair owner {owner}")
                continue
            filename = Path(owner).name
            match = re.search(rf"^{re.escape(filename)}: ([0-9a-f]{{40}})$", text, re.MULTILINE)
            if match is None:
                errors.append(f"invalid pair hash row for {owner}")
            elif git_blob_hash(owner_path) != match.group(1):
                errors.append(f"pair hash mismatch for {owner}")
    return errors


def classify_checkout(checkout: Path, lock: dict[str, Any]) -> dict[str, Any]:
    controls = lock.get("controls")
    sources = lock.get("published_sources")
    pairs = lock.get("pairing_records")
    if not isinstance(controls, list) or not isinstance(sources, list) or not isinstance(pairs, list):
        raise SyncError("baseline lock has invalid file lists")
    control_changes = [
        {"path": record.get("path"), "state": compare_locked_file(checkout, record)}
        for record in controls
        if compare_locked_file(checkout, record) != "unchanged"
    ]
    source_changes = [
        {"path": record.get("path"), "state": compare_locked_file(checkout, record)}
        for record in sources
        if compare_locked_file(checkout, record) != "unchanged"
    ]
    pair_errors = validate_pair_records(checkout, pairs)
    blockers = [
        {"kind": "control_changed", **change}
        for change in control_changes
    ]
    blockers.extend({"kind": "pair_invalid", "message": error} for error in pair_errors)
    blockers.extend(
        {"kind": "source_missing", **change}
        for change in source_changes
        if change["state"] == "missing"
    )
    return {
        "control_changes": control_changes,
        "source_changes": source_changes,
        "pair_errors": pair_errors,
        "blockers": blockers,
    }


def command_discover(args: argparse.Namespace) -> int:
    root = repository_root(args.repo_root)
    run_id, run = resolve_run(root, args.run_id)
    output = run / "reports/discovery.json"
    if output.exists():
        raise SyncError("immutable discovery report already exists")
    metadata = read_json(run / "run.json")
    lock = read_json(run / "baseline/upstream-lock.json")
    classification = classify_checkout(run / "checkout", lock)
    upstream_commit = metadata.get("upstream_commit")
    baseline_commit = metadata.get("baseline_commit")
    if classification["blockers"]:
        status = "blocked"
    elif upstream_commit == baseline_commit:
        status = "no_update"
    elif not classification["source_changes"]:
        status = "no_content_update"
    else:
        status = "ready"
    report = {
        "schema_version": 1,
        "run_id": run_id,
        "created_at": utc_now(),
        "status": status,
        "baseline_commit": baseline_commit,
        "upstream_commit": upstream_commit,
        **classification,
    }
    write_json_atomic(output, report)
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 2 if status == "blocked" else 0


def copy_path(source: Path, destination: Path) -> None:
    if destination.exists() or destination.is_symlink():
        if destination.is_dir() and not destination.is_symlink():
            shutil.rmtree(destination)
        else:
            destination.unlink()
    destination.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        shutil.copytree(source, destination, symlinks=True)
    else:
        shutil.copy2(source, destination)


def command_apply(args: argparse.Namespace) -> int:
    root = repository_root(args.repo_root)
    run_id, run = resolve_run(root, args.run_id)
    receipt_path = run / "apply.json"
    if receipt_path.exists():
        raise SyncError("immutable apply receipt already exists")
    discovery = read_json(run / "reports/discovery.json")
    if discovery.get("status") != "ready":
        raise SyncError(f"apply requires discovery status ready, got {discovery.get('status')}")
    checkout = run / "checkout"
    backup = run / "backup"
    backup.mkdir()
    controlled = [
        "docs",
        "website/docs.ts",
        "website/.vitepress/config.ts",
        "website/public",
        "LICENSE",
        "config/upstream-lock.json",
        "config/upstream-tree.json",
        "config/docs-manifest.json",
    ]
    for relative_path in controlled:
        source = root / relative_path
        if source.exists():
            copy_path(source, backup / relative_path)
    before_lock = sha256_file(root / "config/upstream-lock.json")
    started_at = utc_now()
    try:
        for relative_path in [
            "docs",
            "website/docs.ts",
            "website/.vitepress/config.ts",
            "website/public",
            "LICENSE",
        ]:
            copy_path(checkout / relative_path, root / relative_path)
        result = run_command(
            [
                "pnpm",
                "exec",
                "tsx",
                "scripts/capture-upstream.ts",
                "--source",
                str(checkout),
            ],
            root,
        )
        receipt = {
            "schema_version": 1,
            "run_id": run_id,
            "status": "passed",
            "started_at": started_at,
            "completed_at": utc_now(),
            "backup_path": str(backup.relative_to(root)),
            "before_lock_sha256": before_lock,
            "after_lock_sha256": sha256_file(root / "config/upstream-lock.json"),
            "capture_output": result.stdout.strip(),
        }
        write_json_atomic(receipt_path, receipt)
        print(json.dumps(receipt, ensure_ascii=False, indent=2))
        return 0
    except Exception:
        for relative_path in controlled:
            source = backup / relative_path
            if source.exists():
                copy_path(source, root / relative_path)
        raise


def command_evidence(args: argparse.Namespace) -> int:
    root = repository_root(args.repo_root)
    _, run = resolve_run(root, args.run_id)
    if args.type != "browser":
        raise SyncError("first-version evidence type must be browser")
    source = Path(args.from_file).resolve()
    evidence = read_json(source)
    if evidence.get("status") != "passed":
        raise SyncError("browser evidence status must be passed")
    checks = evidence.get("checks")
    if not isinstance(checks, list) or not checks:
        raise SyncError("browser evidence must contain concrete checks")
    destination = run / "evidence/browser.json"
    if destination.exists():
        raise SyncError("browser evidence is append-only and already exists")
    write_json_atomic(destination, evidence)
    print(destination)
    return 0


def input_fingerprint(root: Path) -> tuple[str, list[dict[str, str]]]:
    records: list[dict[str, str]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root)
        if any(part in EXCLUDED_FINGERPRINT_PARTS for part in relative.parts):
            continue
        records.append({"path": relative.as_posix(), "sha256": sha256_file(path)})
    digest = sha256_bytes(json.dumps(records, separators=(",", ":")).encode())
    return digest, records


def run_gate(root: Path, run: Path, command: list[str], fingerprint: str, index: int) -> dict[str, Any]:
    started_at = utc_now()
    result = run_command(command, root, check=False)
    completed_at = utc_now()
    log = (result.stdout or "") + (result.stderr or "")
    log_path = run / f"ledger/{index:02d}-{'-'.join(command[1:3]).replace('/', '-')}.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_path.write_text(log)
    receipt = {
        "command": command,
        "started_at": started_at,
        "completed_at": completed_at,
        "exit_code": result.returncode,
        "input_fingerprint": fingerprint,
        "log": str(log_path.relative_to(run)),
        "log_sha256": sha256_file(log_path),
    }
    write_json_atomic(log_path.with_suffix(".json"), receipt)
    if result.returncode != 0:
        raise SyncError(f"validation command failed: {' '.join(command)}; see {log_path}")
    return receipt


def validate_browser_evidence(run: Path, discovery: dict[str, Any]) -> None:
    if discovery.get("status") != "ready":
        return
    evidence_path = run / "evidence/browser.json"
    if not evidence_path.is_file():
        raise SyncError("material synchronization requires imported browser evidence")
    evidence = read_json(evidence_path)
    source_paths = {
        change.get("path")
        for change in discovery.get("source_changes", [])
        if isinstance(change, dict) and change.get("state") == "changed"
    }
    checked = set(evidence.get("checked_source_paths", []))
    missing = sorted(path for path in source_paths if isinstance(path, str) and path not in checked)
    if missing:
        raise SyncError(f"browser evidence does not cover changed sources: {', '.join(missing)}")


def command_verify(args: argparse.Namespace) -> int:
    root = repository_root(args.repo_root)
    run_id, run = resolve_run(root, args.run_id)
    verification = run / "verification.json"
    if verification.exists():
        raise SyncError("formal verification is immutable and already exists")
    discovery = read_json(run / "reports/discovery.json")
    if discovery.get("status") == "blocked":
        raise SyncError("blocked discovery cannot be verified")
    if discovery.get("status") == "ready" and not (run / "apply.json").is_file():
        raise SyncError("material discovery must be applied before verification")
    started_at = utc_now()
    try:
        validate_browser_evidence(run, discovery)
        fingerprint, records = input_fingerprint(root)
        write_json_atomic(
            run / "metadata/input-fingerprint.json",
            {"schema_version": 1, "sha256": fingerprint, "files": records},
        )
        commands = [
            ["pnpm", "exec", "tsc", "--noEmit"],
            ["pnpm", "run", "docs:check"],
            ["pnpm", "run", "build"],
            ["pnpm", "run", "docs:routes"],
        ]
        receipts = [run_gate(root, run, command, fingerprint, index) for index, command in enumerate(commands, 1)]
        current_fingerprint, _ = input_fingerprint(root)
        if current_fingerprint != fingerprint:
            raise SyncError("repository input changed during formal verification")
        result = {
            "schema_version": 1,
            "run_id": run_id,
            "status": "passed",
            "started_at": started_at,
            "completed_at": utc_now(),
            "input_fingerprint": fingerprint,
            "receipts": receipts,
            "browser_evidence": "evidence/browser.json" if discovery.get("status") == "ready" else None,
        }
        write_json_atomic(verification, result)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        write_json_atomic(
            verification,
            {
                "schema_version": 1,
                "run_id": run_id,
                "status": "blocked",
                "started_at": started_at,
                "completed_at": utc_now(),
                "blocker": str(error),
            },
        )
        raise


def render_result(run_id: str, discovery: dict[str, Any], verification: dict[str, Any]) -> str:
    source_changes = discovery.get("source_changes", [])
    rows = []
    for change in source_changes:
        if not isinstance(change, dict):
            continue
        path = change.get("path", "unknown")
        state = change.get("state", "unknown")
        rows.append(f"| `{path}` | {state} | 中 | 官方双语内容变更，建议抽查语义与渲染 |")
    table = "\n".join(rows) if rows else "| — | 无正文变化 | — | 无需翻译 |"
    return f"""# DeepSeek Harness 文档同步结果

## 同步结果

- Run ID：`{run_id}`
- 状态：`{verification.get('status')}`
- Discovery：`{discovery.get('status')}`
- 上游：`{discovery.get('baseline_commit')}` → `{discovery.get('upstream_commit')}`
- 首版 locale：简体中文、English
- 日文/韩文：已配置，未发布，未生成回退译文

## 更新页面总览

| 官方来源 | 变化 | 程度 | 说明 |
| --- | --- | --- | --- |
{table}

## 菜单变化

{('无。' if not discovery.get('control_changes') else '存在阻断性的 publication control 变化；本结果不应发布。')}

## 修改程度说明

- 低：字面量或链接小改动。
- 中：有界正文、代码、表格或图片变化。
- 高：目录、路由、架构、协议、安全或大规模结构变化。

## 正文/组件变化页面

本报告以冻结 Git checkout、官方 Git blob、SHA-256、构建收据和浏览器证据为准。
"""


def command_result(args: argparse.Namespace) -> int:
    root = repository_root(args.repo_root)
    run_id, run = resolve_run(root, args.run_id)
    immutable = run / "reports/result.md"
    if immutable.exists():
        raise SyncError("immutable result already exists")
    verification = read_json(run / "verification.json")
    if verification.get("status") != "passed":
        raise SyncError("result requires passed formal verification")
    discovery = read_json(run / "reports/discovery.json")
    text = render_result(run_id, discovery, verification)
    write_text_atomic(immutable, text)
    write_text_atomic(root / "diff/result.md", text)
    write_json_atomic(
        root / "diff/latest.json",
        {
            "schema_version": 1,
            "run_id": run_id,
            "result_sha256": sha256_file(immutable),
            "published_at": utc_now(),
        },
    )
    print(immutable)
    return 0


def parser() -> argparse.ArgumentParser:
    root_parser = argparse.ArgumentParser(description=__doc__)
    subparsers = root_parser.add_subparsers(dest="command", required=True)

    check = subparsers.add_parser("check")
    check.add_argument("--repo-root", default=".")
    check.add_argument("--require-update", action="store_true")
    check.set_defaults(handler=command_check)

    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--repo-root", default=".")
    prepare.add_argument("--run-id", required=True)
    prepare.add_argument("--recovery-run-id")
    prepare.add_argument("--upstream-path")
    prepare.add_argument("--allow-test-upstream", action="store_true", help=argparse.SUPPRESS)
    prepare.set_defaults(handler=command_prepare)

    for name, handler in [
        ("discover", command_discover),
        ("apply", command_apply),
        ("verify", command_verify),
        ("result", command_result),
    ]:
        command = subparsers.add_parser(name)
        command.add_argument("--repo-root", default=".")
        command.add_argument("--run-id")
        command.set_defaults(handler=handler)

    evidence = subparsers.add_parser("evidence")
    evidence.add_argument("--repo-root", default=".")
    evidence.add_argument("--run-id")
    evidence.add_argument("--type", required=True)
    evidence.add_argument("--from-file", required=True)
    evidence.set_defaults(handler=command_evidence)
    return root_parser


def main(argv: list[str] | None = None) -> int:
    arguments = parser().parse_args(argv)
    try:
        return int(arguments.handler(arguments))
    except SyncError as error:
        print(f"diff-translation: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
