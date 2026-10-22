"""Speaker-identity and owner resolution rules.

A diarization label (SPEAKER_02, Speaker_00, "0") is never a person. An owner is
only inferred from first-person speech ("I will...") when the organiser has
mapped that speaker label to a person.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

ANON_LABEL = re.compile(r"^(?:speaker|spk|spkr)?[\s_\-]*\d+$", re.I)

SELF_TOKENS = {
    "self", "i", "me", "myself", "speaker", "the speaker",
    # Kannada / Hindi first person (romanised)
    "naanu", "nanu", "naan", "main", "mein", "mai", "mujhe",
}
GROUP_TOKENS = {
    "we", "us", "our team", "team", "the team", "someone", "somebody", "anyone",
    "anybody", "everyone", "everybody", "all", "all of us", "nobody", "they", "both",
    "unassigned", "none", "null", "tbd", "unknown",
}


def is_anonymous_label(label: str | None) -> bool:
    return bool(label) and bool(ANON_LABEL.match(label.strip()))


class SpeakerDirectory:
    """Maps diarization speaker labels to organiser-confirmed display names.

    `mapping[label] = name` means the organiser confirmed that label is `name`.
    Labels that are not anonymous-looking (e.g. "Rahul" from an imported, already
    attributed transcript) are treated as attributed names unless `strict` is set.
    """

    def __init__(self, mapping: dict[str, str] | None = None, *, strict: bool = False,
                 known_people: list[str] | None = None):
        self.mapping = {k: v for k, v in (mapping or {}).items() if v}
        self.strict = strict
        self.known_people = list(known_people or [])

    def name_for(self, label: str | None) -> str | None:
        if not label:
            return None
        if label in self.mapping:
            return self.mapping[label]
        if self.strict or is_anonymous_label(label):
            return None
        return label

    def is_mapped(self, label: str | None) -> bool:
        return self.name_for(label) is not None

    def people(self) -> list[str]:
        names = set(self.mapping.values()) | set(self.known_people)
        if not self.strict:
            names |= {lbl for lbl in self.mapping if not is_anonymous_label(lbl)}
        return sorted(names)


@dataclass
class OwnerResolution:
    name: str | None
    status: str  # named | self_mapped | self_unmapped | unmapped_label | group | missing
    unmapped_label: str | None = None
    note: str | None = None

    @property
    def needs_identity(self) -> bool:
        return self.status in ("self_unmapped", "unmapped_label")


def _clean(value: str) -> str:
    return re.sub(r"[\"'`.,;:!?()\[\]]", "", value).strip()


def resolve_owner(owner_raw: str | None, speaker_label: str | None,
                  directory: SpeakerDirectory) -> OwnerResolution:
    if owner_raw is None or not _clean(owner_raw):
        return OwnerResolution(None, "missing")
    owner = _clean(owner_raw)
    low = owner.lower()

    if low in SELF_TOKENS:
        name = directory.name_for(speaker_label)
        if name:
            return OwnerResolution(name, "self_mapped")
        return OwnerResolution(None, "self_unmapped", unmapped_label=speaker_label,
                               note=f"'{speaker_label}' volunteered but is not mapped to a person")
    if low in GROUP_TOKENS:
        return OwnerResolution(None, "group", note=f"'{owner}' is not a single responsible person")

    if owner in directory.mapping:  # label that the organiser has mapped
        return OwnerResolution(directory.mapping[owner], "named")
    if is_anonymous_label(owner):
        return OwnerResolution(None, "unmapped_label", unmapped_label=owner,
                               note=f"'{owner}' is a diarization label, not a verified person")

    # Canonicalise against known people (case-insensitive) without inventing names.
    for person in directory.people():
        if person.lower() == low:
            return OwnerResolution(person, "named")
    if owner.islower():
        owner = " ".join(w.capitalize() for w in owner.split())
    return OwnerResolution(owner, "named")
