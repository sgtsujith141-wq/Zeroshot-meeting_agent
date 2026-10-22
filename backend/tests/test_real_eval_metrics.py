"""Metric code for the official real-meeting evaluation (no real data needed)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "evaluation"))
from real_eval import action_scores, normalise_words, speaker_accuracy, wer_counts  # noqa: E402


def test_wer_counts_substitution_deletion_insertion():
    ref = normalise_words("Rahul, finish the refund API by Friday.")
    hyp = normalise_words("rahul finish a refund API by friday please")
    c = wer_counts(ref, hyp)
    assert (c["substitutions"], c["deletions"], c["insertions"]) == (1, 0, 1)
    assert c["reference_words"] == 7 and c["wer"] == round(2 / 7, 4)


def test_wer_keeps_non_latin_scripts_and_normalises_case():
    assert normalise_words("API ready ಆದಮೇಲೆ naanu") == ["api", "ready", "ಆದಮೇಲೆ", "naanu"]
    assert wer_counts(["a"], ["a"])["wer"] == 0


def test_speaker_accuracy_uses_best_label_mapping():
    ref = [{"speaker": "Asha", "start": 0, "end": 10}, {"speaker": "Rahul", "start": 10, "end": 20}]
    hyp = [{"speaker": "SPEAKER_01", "start": 0, "end": 12}, {"speaker": "SPEAKER_00", "start": 12, "end": 20}]
    r = speaker_accuracy(ref, hyp)
    assert r["label_mapping"] == {"SPEAKER_01": "Asha", "SPEAKER_00": "Rahul"}
    assert r["accuracy"] == 0.9  # 2 s of Rahul's speech attributed to Asha's label


def test_action_precision_recall():
    ref = [{"id": "A1", "title": "Refund API", "owner": "Rahul", "due_date": "2026-10-22", "match_keywords": [["refund"]]},
           {"id": "A2", "title": "Regression tests", "owner": "Priya", "match_keywords": [["regression"]]}]
    sys_a = [{"title": "Finish the refund API", "owner": "Rahul", "due_date": "2026-10-22"},
             {"title": "Update wiki", "owner": None, "due_date": None}]
    s = action_scores(ref, sys_a)
    assert s["lenient"] == {"precision": 0.5, "recall": 0.5, "f1": 0.5}
    assert s["strict"]["precision"] == 0.5 and s["unmatched_system_actions"] == ["Update wiki"]
