#!/usr/bin/env bash
# Builds a SYNTHETIC text-to-speech meeting clip (macOS `say`) to check the audio pipeline
# mechanically: upload -> FFmpeg -> speech-to-text -> interpretation -> review.
# It is NOT a real meeting and NOT part of the official three-real-meeting evaluation.
# Output (git-ignored): demo/audio/synthetic_tts_meeting.m4a and its reference transcript.
set -euo pipefail
cd "$(dirname "$0")/.."
out=demo/audio
mkdir -p "$out/parts"
lines=(
  "Rishi|Lead|Okay team, quick sync on the mobile app launch."
  "Rishi|Lead|Kavya, please finish the login screen by Friday."
  "Lekha|Kavya|ठीक है, मैं login screen शुक्रवार तक पूरा कर दूँगी।"
  "Daniel|Arjun|The payment API is done and merged."
  "Rishi|Lead|Great. Meera, once the payment API is live, start the release notes."
  "Soumya|Meera|ಸರಿ, ನಾನು ನಾಳೆ release notes ಶುರು ಮಾಡ್ತೀನಿ."
)
: > "$out/parts/list.txt"
ref='{"synthetic": true, "note": "Reference = exact text given to macOS text-to-speech. Speakers are the voices used.", "segments": ['
t=0; i=0
for row in "${lines[@]}"; do
  IFS='|' read -r voice speaker text <<<"$row"
  f="$out/parts/l$i.aiff"
  say -v "$voice" -o "$f" "$text"
  ffmpeg -nostdin -loglevel error -y -i "$f" -ar 16000 -ac 1 "$out/parts/l$i.wav"
  ffmpeg -nostdin -loglevel error -y -f lavfi -i anullsrc=r=16000:cl=mono -t 0.7 "$out/parts/gap$i.wav"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/parts/l$i.wav")
  end=$(python3 -c "print(round($t + $d, 2))")
  sep=$([ $i -gt 0 ] && echo "," || echo "")
  ref="$ref$sep{\"speaker\": \"$speaker\", \"start\": $t, \"end\": $end, \"text\": $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$text")}"
  t=$(python3 -c "print(round($end + 0.7, 2))")
  printf "file 'l%s.wav'\nfile 'gap%s.wav'\n" "$i" "$i" >> "$out/parts/list.txt"
  i=$((i+1))
done
ffmpeg -nostdin -loglevel error -y -f concat -safe 0 -i "$out/parts/list.txt" -c:a aac -b:a 96k "$out/synthetic_tts_meeting.m4a"
echo "$ref]}" | python3 -m json.tool > "$out/synthetic_tts_meeting.reference.json"
rm -rf "$out/parts"
echo "wrote $out/synthetic_tts_meeting.m4a ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out/synthetic_tts_meeting.m4a") s) and its reference transcript"
