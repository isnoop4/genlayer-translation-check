"""A tiny stand-in for the GenLayer SDK, for logic tests only.

It lets tests/test_logic.py import contracts/translation_check.py with
plain `python3` (no GenVM, no gltest, no network) so the module-level pure
functions can be tested: sanitising, the injection phrase scan, the digit
comparison, rubric validation, verdict derivation and the validator's
judge().

It is NOT GenVM and it does not run the contract class. The contract's
methods are covered by tests/test_translation_check.py through gltest.
"""
import importlib.util
import sys
import types
import typing
from pathlib import Path

CONTRACT = Path(__file__).resolve().parent.parent / "contracts" / "translation_check.py"


class u256(int):
    pass


class Address:
    def __init__(self, value):
        if isinstance(value, str):
            value = bytes.fromhex(value[2:] if value.startswith("0x") else value)
        self.as_bytes = bytes(value)


class TreeMap(dict):
    def __class_getitem__(cls, item):
        return typing.Annotated[cls, item]


class UserError(Exception):
    pass


def _passthrough(fn):
    return fn


def load():
    """Import the contract module against this stub and return it."""
    write = _passthrough
    gl = types.SimpleNamespace(
        Contract=object,
        public=types.SimpleNamespace(view=_passthrough, write=write),
        vm=types.SimpleNamespace(UserError=UserError),
    )
    stub = types.ModuleType("genlayer")
    stub.gl = gl
    stub.u256 = u256
    stub.Address = Address
    stub.TreeMap = TreeMap
    stub.__all__ = ["gl", "u256", "Address", "TreeMap"]

    previous = sys.modules.get("genlayer")
    sys.modules["genlayer"] = stub
    try:
        spec = importlib.util.spec_from_file_location("translation_check_under_test", CONTRACT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    finally:
        if previous is None:
            del sys.modules["genlayer"]
        else:
            sys.modules["genlayer"] = previous
    return module
