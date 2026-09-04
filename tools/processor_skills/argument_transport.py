"""Decode the original Windows command line captured by a CMD entrypoint."""

from __future__ import annotations

import ctypes
import os
from ctypes import wintypes
from typing import Sequence


TRANSPORT_VERSION = "windows-command-line-v1"
TRANSPORT_ENV = "PROCESSOR_SKILLS_ARG_TRANSPORT"
RAW_ARGUMENTS_ENV = "PROCESSOR_SKILLS_RAW_ARGUMENTS"
FIXED_COMMAND_ENV = "PROCESSOR_SKILLS_FIXED_COMMAND"


def split_windows_command_line(raw: str) -> list[str]:
    if os.name != "nt":
        raise RuntimeError("Windows command-line transport requires Windows")
    shell32 = ctypes.WinDLL("shell32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    command_line_to_argv = shell32.CommandLineToArgvW
    command_line_to_argv.argtypes = [wintypes.LPCWSTR, ctypes.POINTER(ctypes.c_int)]
    command_line_to_argv.restype = ctypes.POINTER(wintypes.LPWSTR)
    local_free = kernel32.LocalFree
    local_free.argtypes = [wintypes.HLOCAL]
    local_free.restype = wintypes.HLOCAL

    count = ctypes.c_int()
    values = command_line_to_argv(f"processor-skills.exe {raw}", ctypes.byref(count))
    if not values:
        raise OSError(ctypes.get_last_error(), "CommandLineToArgvW failed")
    try:
        return [values[index] for index in range(1, count.value)]
    finally:
        local_free(values)


def arguments_from_environment(fallback: Sequence[str]) -> list[str]:
    transport = os.environ.pop(TRANSPORT_ENV, None)
    if transport is None:
        return list(fallback)
    raw = os.environ.pop(RAW_ARGUMENTS_ENV, "")
    fixed = os.environ.pop(FIXED_COMMAND_ENV, "")
    if transport != TRANSPORT_VERSION:
        raise ValueError(f"unsupported CMD argument transport: {transport}")
    arguments = split_windows_command_line(raw)
    return [fixed, *arguments] if fixed else arguments
