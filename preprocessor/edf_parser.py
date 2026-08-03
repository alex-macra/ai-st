"""
Discover EDF channels per-file - never assume a fixed channel set.
SOMNOtouch RESP recordings vary: some have SpO2, some do not; flow channel
names differ across firmware versions.
"""

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import pyedflib


@dataclass
class ChannelInfo:
    index: int
    label: str
    sample_rate: float
    physical_min: float
    physical_max: float
    unit: str
    duration_sec: float
    present: bool = True
    n_samples: int = 0


@dataclass
class ChannelInventory:
    duration_sec: float
    channels: list[ChannelInfo] = field(default_factory=list)

    def by_label(self, label: str) -> ChannelInfo | None:
        label_lower = label.lower()
        for ch in self.channels:
            if ch.label.lower() == label_lower:
                return ch
        return None

    def labels(self) -> list[str]:
        return [ch.label for ch in self.channels]


@dataclass
class Demographics:
    """De-identified demographics derived from the EDF patient header.

    Birthdate and patient name are NEVER included - they are PHI under HIPAA.
    Age in years is safe to surface (HIPAA Safe Harbor: ages ≤ 89 are not PHI).
    Sex is not PHI.
    """

    age_years: int | None
    sex: str | None  # 'M' | 'F' | 'X' | None


_BIRTHDATE_FORMATS = ("%d %b %Y", "%d-%b-%Y", "%d %B %Y", "%d-%B-%Y")


def _parse_birthdate(raw: str) -> datetime | None:
    if not raw:
        return None
    cleaned = raw.strip().replace("  ", " ")
    for fmt in _BIRTHDATE_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue
        try:
            return datetime.strptime(cleaned.title(), fmt)
        except ValueError:
            continue
    return None


def _normalise_sex(raw: str | None) -> str | None:
    if not raw:
        return None
    s = raw.strip().lower()
    if s.startswith("m"):
        return "M"
    if s.startswith("f"):
        return "F"
    if s.startswith("x") or s in ("u", "unknown", "other"):
        return "X"
    return None


def extract_demographics(edf_path: Path) -> Demographics:
    """Read patient demographics from the EDF+ header BEFORE de-identification.

    Returns derived (age in years, sex) only - never name, code, or birthdate.
    Caller is responsible for invoking this on the raw EDF before scrubbing.
    """
    with pyedflib.EdfReader(str(edf_path)) as reader:
        birthdate_raw = reader.getBirthdate()
        sex_raw = reader.getSex()
        start = reader.getStartdatetime()

    sex = _normalise_sex(sex_raw)
    birth_dt = _parse_birthdate(birthdate_raw)
    age: int | None = None
    if birth_dt is not None and isinstance(start, datetime):
        diff = start - birth_dt
        age_years = int(diff.days // 365.25)
        if 0 <= age_years <= 89:
            age = age_years
    return Demographics(age_years=age, sex=sex)


def parse_edf(edf_path: Path) -> ChannelInventory:
    """
    Read EDF header and return a ChannelInventory.
    Does not load signal data into memory beyond what is needed for metadata.
    """
    with pyedflib.EdfReader(str(edf_path)) as reader:
        n = reader.signals_in_file
        duration_sec = reader.getFileDuration()
        headers = reader.getSignalHeaders()

        channels: list[ChannelInfo] = []
        for i in range(n):
            hdr = headers[i]
            sample_rate = float(reader.getSampleFrequency(i))
            n_samples = reader.getNSamples()[i]
            channels.append(
                ChannelInfo(
                    index=i,
                    label=hdr["label"].strip(),
                    sample_rate=sample_rate,
                    physical_min=float(hdr["physical_min"]),
                    physical_max=float(hdr["physical_max"]),
                    unit=hdr["dimension"].strip(),
                    duration_sec=duration_sec,
                    n_samples=int(n_samples),
                )
            )

    return ChannelInventory(duration_sec=duration_sec, channels=channels)
