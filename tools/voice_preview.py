"""Generate a local voice audition through the installed GPT-SoVITS API.
Run the engine separately on 127.0.0.1:9880; this tool never starts it or records audio.
"""
from pathlib import Path
import argparse
import io
import json
import urllib.request
import wave

ROOT = Path(__file__).resolve().parents[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def synthesize(reference, prompt_text, text, output, language="zh"):
    if language not in {'zh', 'ja'}: raise ValueError('Unsupported audition language')
    reference = Path(reference).resolve(strict=True)
    if not reference.is_file() or not prompt_text.strip() or not text.strip() or len(text) > 500:
        raise ValueError('Need a reference file, its exact transcript, and 1-500 output characters')
    output = Path(output).resolve()
    if output == reference:
        raise ValueError('Output must not overwrite the reference')
    request = urllib.request.Request('http://127.0.0.1:9880/tts', method='POST',
        headers={'Content-Type': 'application/json'},
        data=json.dumps({'text': text, 'text_lang': language, 'ref_audio_path': str(reference),
                         'prompt_text': prompt_text, 'prompt_lang': language, 'batch_size': 1,
                         'parallel_infer': False, 'text_split_method': 'cut5', 'media_type': 'wav',
                         'streaming_mode': False, 'speed_factor': 1.0, 'seed': 42}, ensure_ascii=False).encode('utf-8'))
    with urllib.request.build_opener(NoRedirect).open(request, timeout=90) as response:
        data = response.read(32 * 2**20 + 1)
    if len(data) > 32 * 2**20 or data[:4] != b'RIFF' or data[8:12] != b'WAVE':
        raise ValueError('Voice service did not return a bounded WAV file')
    with wave.open(io.BytesIO(data), 'rb') as audio:
        result = {'seconds': round(audio.getnframes()/audio.getframerate(), 3), 'sampleRate': audio.getframerate()}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(data)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', required=True)
    parser.add_argument('--prompt-text', required=True)
    parser.add_argument('--text', default='你好，我在这里。今天想聊些什么？')
    parser.add_argument('--language', choices=['zh','ja'], default='zh')
    parser.add_argument('--output', type=Path, default=ROOT / 'data/voice-reference/audition.wav')
    args = parser.parse_args()
    print(json.dumps(synthesize(args.reference, args.prompt_text, args.text, args.output, args.language), ensure_ascii=False))
