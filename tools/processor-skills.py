#!/usr/bin/env python3
"""Stable script entrypoint for Processor Development Skills."""

from __future__ import annotations

import sys
from pathlib import Path


TOOLS_ROOT = Path(__file__).resolve().parent
if str(TOOLS_ROOT) not in sys.path:
    sys.path.insert(0, str(TOOLS_ROOT))

from processor_skills.argument_transport import arguments_from_environment
from processor_skills.cli import main


if __name__ == "__main__":
    raise SystemExit(main(arguments_from_environment(sys.argv[1:])))
