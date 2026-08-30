#!/usr/bin/env python3
"""Extract one Vivado report_timing path into primitive/net stages."""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


PATH_START_RE = re.compile(
    r"^Slack \((?P<status>MET|VIOLATED)\)\s*:\s*"
    r"(?P<slack>-?\d+(?:\.\d+)?)ns",
    re.MULTILINE,
)
SEPARATOR_RE = re.compile(r"^\s*-{20,}\s*(?:-+)?\s*$")
INLINE_CELL_RE = re.compile(
    r"^\s*(?P<site>\S+)\s+(?P<primitive>[A-Z][A-Z0-9_]*)\s+"
    r"\((?P<arc>[^)]*)\)\s+(?P<incr>-?\d+\.\d+)\s+"
    r"(?P<path>-?\d+\.\d+)\s+[rf]\s+(?P<resource>.+?)\s*$"
)
SPLIT_CELL_HEAD_RE = re.compile(
    r"^\s*(?P<site>\S+)\s+(?P<primitive>[A-Z][A-Z0-9_]*)\s+"
    r"\((?P<arc>[^)]*)\)\s*$"
)
SPLIT_CELL_VALUE_RE = re.compile(
    r"^\s*(?P<incr>-?\d+\.\d+)\s+(?P<path>-?\d+\.\d+)\s+"
    r"[rf]\s+(?P<resource>.+?)\s*$"
)
NET_RE = re.compile(
    r"^\s*net\s+\(fo=(?P<fanout>\d+),\s*(?P<route_state>[^)]+)\)\s+"
    r"(?P<incr>-?\d+\.\d+)\s+(?P<path>-?\d+\.\d+)\s+"
    r"(?P<resource>.+?)\s*$"
)


@dataclass
class Stage:
    index: int
    site: str
    primitive: str
    arc: str
    cell_resource: str
    cell_delay_ns: float
    following_net: str = ""
    route_state: str = ""
    route_delay_ns: float = 0.0
    fanout: int | None = None
    cumulative_after_cell_ns: float = 0.0
    cumulative_after_route_ns: float = 0.0


@dataclass
class TimingPath:
    status: str
    slack_ns: float
    source: str
    destination: str
    requirement_ns: float | None
    data_path_delay_ns: float | None
    logic_delay_ns: float | None
    route_delay_ns: float | None
    logic_levels: int | None
    primitive_counts: str
    stages: list[Stage]


def field(pattern: str, block: str, group: int = 1) -> str:
    match = re.search(pattern, block, re.MULTILINE)
    return match.group(group).strip() if match else ""


def optional_float(value: str) -> float | None:
    return float(value) if value else None


def split_blocks(text: str) -> list[tuple[str, str, float]]:
    starts = list(PATH_START_RE.finditer(text))
    blocks: list[tuple[str, str, float]] = []
    for index, match in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(text)
        blocks.append((match.group("status"), text[match.start():end], float(match.group("slack"))))
    return blocks


def data_section(block: str) -> list[str]:
    lines = block.splitlines()
    separators = [index for index, line in enumerate(lines) if SEPARATOR_RE.match(line)]
    if len(separators) < 3:
        return []
    return lines[separators[1] + 1:separators[2]]


def parse_stages(block: str) -> list[Stage]:
    lines = data_section(block)
    raw_stages: list[dict[str, object]] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        cell_match = INLINE_CELL_RE.match(line)
        parsed: dict[str, object] | None = None

        if cell_match:
            values = cell_match.groupdict()
            parsed = {
                "site": values["site"],
                "primitive": values["primitive"],
                "arc": values["arc"],
                "cell_resource": values["resource"],
                "cell_delay_ns": float(values["incr"]),
                "cell_path_ns": float(values["path"]),
            }
            index += 1
        else:
            head_match = SPLIT_CELL_HEAD_RE.match(line)
            if head_match and index + 1 < len(lines):
                value_match = SPLIT_CELL_VALUE_RE.match(lines[index + 1])
                if value_match:
                    values = {**head_match.groupdict(), **value_match.groupdict()}
                    parsed = {
                        "site": values["site"],
                        "primitive": values["primitive"],
                        "arc": values["arc"],
                        "cell_resource": values["resource"],
                        "cell_delay_ns": float(values["incr"]),
                        "cell_path_ns": float(values["path"]),
                    }
                    index += 2

        if parsed is None:
            index += 1
            continue

        raw_stages.append(parsed)

        if index < len(lines):
            net_match = NET_RE.match(lines[index])
            if net_match:
                net_values = net_match.groupdict()
                raw_stages[-1].update(
                    {
                        "following_net": net_values["resource"],
                        "route_state": net_values["route_state"],
                        "route_delay_ns": float(net_values["incr"]),
                        "route_path_ns": float(net_values["path"]),
                        "fanout": int(net_values["fanout"]),
                    }
                )
                index += 1

    if not raw_stages:
        return []

    first = raw_stages[0]
    base_path_ns = float(first["cell_path_ns"]) - float(first["cell_delay_ns"])
    stages: list[Stage] = []
    for stage_index, raw in enumerate(raw_stages):
        after_cell = float(raw["cell_path_ns"]) - base_path_ns
        route_path = raw.get("route_path_ns")
        after_route = float(route_path) - base_path_ns if route_path is not None else after_cell
        stages.append(
            Stage(
                index=stage_index,
                site=str(raw["site"]),
                primitive=str(raw["primitive"]),
                arc=str(raw["arc"]),
                cell_resource=str(raw["cell_resource"]),
                cell_delay_ns=float(raw["cell_delay_ns"]),
                following_net=str(raw.get("following_net", "")),
                route_state=str(raw.get("route_state", "")),
                route_delay_ns=float(raw.get("route_delay_ns", 0.0)),
                fanout=raw.get("fanout") if isinstance(raw.get("fanout"), int) else None,
                cumulative_after_cell_ns=after_cell,
                cumulative_after_route_ns=after_route,
            )
        )
    return stages


def parse_path(status: str, block: str, slack_ns: float) -> TimingPath:
    delay_match = re.search(
        r"Data Path Delay:\s*(-?\d+\.\d+)ns\s+\(logic\s+"
        r"(-?\d+\.\d+)ns.*?route\s+(-?\d+\.\d+)ns",
        block,
    )
    levels_match = re.search(r"Logic Levels:\s*(\d+)\s+\(([^)]*)\)", block)
    return TimingPath(
        status=status,
        slack_ns=slack_ns,
        source=field(r"^\s*Source:\s+(.+)$", block),
        destination=field(r"^\s*Destination:\s+(.+)$", block),
        requirement_ns=optional_float(field(r"^\s*Requirement:\s*(-?\d+\.\d+)ns", block)),
        data_path_delay_ns=float(delay_match.group(1)) if delay_match else None,
        logic_delay_ns=float(delay_match.group(2)) if delay_match else None,
        route_delay_ns=float(delay_match.group(3)) if delay_match else None,
        logic_levels=int(levels_match.group(1)) if levels_match else None,
        primitive_counts=levels_match.group(2).strip() if levels_match else "",
        stages=parse_stages(block),
    )


def load_paths(path: Path) -> list[TimingPath]:
    text = path.read_text(encoding="utf-8", errors="replace")
    return [parse_path(status, block, slack) for status, block, slack in split_blocks(text)]


def format_num(value: float | None) -> str:
    return "" if value is None else f"{value:.3f}"


def md_escape(value: str) -> str:
    return value.replace("|", "\\|")


def markdown_summary(paths: Iterable[TimingPath]) -> str:
    lines = [
        "| Index | Status | Slack ns | Data ns | Levels | Source | Destination |",
        "|---:|---|---:|---:|---:|---|---|",
    ]
    for index, path in enumerate(paths):
        lines.append(
            f"| {index} | {path.status} | {format_num(path.slack_ns)} | "
            f"{format_num(path.data_path_delay_ns)} | {path.logic_levels or ''} | "
            f"`{md_escape(path.source)}` | `{md_escape(path.destination)}` |"
        )
    return "\n".join(lines) + "\n"


def markdown_path(path: TimingPath) -> str:
    lines = [
        "## Timing path",
        "",
        f"- Status: `{path.status}`",
        f"- Slack: `{format_num(path.slack_ns)} ns`",
        f"- Source: `{path.source}`",
        f"- Destination: `{path.destination}`",
        f"- Requirement: `{format_num(path.requirement_ns)} ns`",
        f"- Data/Logic/Route: `{format_num(path.data_path_delay_ns)}/"
        f"{format_num(path.logic_delay_ns)}/{format_num(path.route_delay_ns)} ns`",
        f"- Logic levels: `{path.logic_levels}` (`{path.primitive_counts}`)",
        "",
        "| Stage | Site | Primitive | Cell resource | Cell ns | Following net | Route ns | Fanout | Cumulative ns | RTL region | Confidence |",
        "|---:|---|---|---|---:|---|---:|---:|---:|---|---|",
    ]
    for stage in path.stages:
        cumulative = stage.cumulative_after_route_ns
        lines.append(
            f"| {stage.index} | `{md_escape(stage.site)}` | `{stage.primitive}` | "
            f"`{md_escape(stage.cell_resource)}` | {stage.cell_delay_ns:.3f} | "
            f"`{md_escape(stage.following_net)}` | {stage.route_delay_ns:.3f} | "
            f"{stage.fanout if stage.fanout is not None else ''} | {cumulative:.3f} |  | measured |"
        )
    return "\n".join(lines) + "\n"


def csv_path(path: TimingPath) -> str:
    output = io.StringIO()
    fieldnames = list(asdict(Stage(0, "", "", "", "", 0.0)).keys())
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for stage in path.stages:
        writer.writerow(asdict(stage))
    return output.getvalue()


def json_path(path: TimingPath) -> str:
    return json.dumps(asdict(path), indent=2, ensure_ascii=False) + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract Vivado report_timing primitive and routed-net stages."
    )
    parser.add_argument("report", type=Path, help="Vivado report_timing text file")
    parser.add_argument("--source", default="", help="startpoint substring filter")
    parser.add_argument("--destination", default="", help="endpoint substring filter")
    parser.add_argument("--path-index", type=int, default=0, help="filtered path index")
    parser.add_argument("--list", action="store_true", help="list matching path summaries")
    parser.add_argument("--format", choices=("markdown", "csv", "json"), default="markdown")
    parser.add_argument("--output", type=Path, help="write output to this file")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    paths = load_paths(args.report)
    matches = [
        path for path in paths
        if args.source in path.source and args.destination in path.destination
    ]
    if not matches:
        print("no timing path matched the requested source and destination", file=sys.stderr)
        return 2

    if args.list:
        rendered = markdown_summary(matches)
    else:
        if args.path_index < 0 or args.path_index >= len(matches):
            print(
                f"path index {args.path_index} is outside 0..{len(matches) - 1}",
                file=sys.stderr,
            )
            return 2
        selected = matches[args.path_index]
        if not selected.stages:
            print("selected path has no parsed data-path stages", file=sys.stderr)
            return 3
        rendered = {
            "markdown": markdown_path,
            "csv": csv_path,
            "json": json_path,
        }[args.format](selected)

    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
