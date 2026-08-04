# Copyright 2026 Alex Macra
# SPDX-License-Identifier: AGPL-3.0-only
import pytest


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "integration: requires external rights-cleared data",
    )
