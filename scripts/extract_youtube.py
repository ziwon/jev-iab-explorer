"""Optional local-only caption extraction. No video download, cookies, proxy, or bypass.

python scripts/extract_youtube.py 'https://www.youtube.com/watch?v=VIDEO_ID' --output local-data/video.json
Uses youtube-transcript-api's public .fetch API. A blocked/unavailable video is an explicit error.
"""
from __future__ import annotations
import argparse
import json
import re
from pathlib import Path
from urllib.parse import urlparse, parse_qs


def video_id(value: str) -> str:
    value = value.strip()
    if re.fullmatch(r'[A-Za-z0-9_-]{11}', value):
        return value
    u = urlparse(value)
    if u.scheme != 'https' or u.username or u.password or u.port:
        raise ValueError('Use an HTTPS YouTube video URL without credentials or a port.')
    result = None
    if u.hostname == 'youtu.be':
        result = u.path[1:]
    elif u.hostname in {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'}:
        if u.path == '/watch':
            result = parse_qs(u.query).get('v', [None])[0]
        else:
            match = re.fullmatch(r'/(?:shorts|embed|live)/([A-Za-z0-9_-]{11})/?', u.path)
            result = match.group(1) if match else None
    if not result or not re.fullmatch(r'[A-Za-z0-9_-]{11}', result):
        raise ValueError('A single YouTube video URL or ID is required.')
    return result


def extract(vid: str, languages: list[str]) -> dict:
    from youtube_transcript_api import YouTubeTranscriptApi
    from requests import Session

    class TimedSession(Session):
        def request(self, *args, **kwargs):
            kwargs.setdefault('timeout', 15)
            return super().request(*args, **kwargs)

    with TimedSession() as session:
        transcript = YouTubeTranscriptApi(http_client=session).fetch(vid, languages=languages)
    segments = [dict(start=x.start, end=x.start+x.duration, text=x.text.strip())
                for x in transcript if x.text.strip() and x.duration > 0]
    if not segments:
        raise ValueError('No usable subtitle cues.')
    if len(segments) > 2000 or sum(len(x['text']) for x in segments) > 40000:
        return {'error': {'code': 'input_too_large', 'message': '자막이 PoC 입력 한도를 초과했어. 필요한 구간을 SRT/VTT 파일로 입력해.'}}
    return {'youtube_url': f'https://www.youtube.com/watch?v={vid}', 'title': '',
            'language': transcript.language_code, 'is_generated': transcript.is_generated,
            'source': 'youtube-transcript-api', 'segments': segments}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('url', nargs='?')
    ap.add_argument('--video-id')
    ap.add_argument('--languages', default='ko,en,ja')
    ap.add_argument('--output', type=Path)
    args = ap.parse_args()
    if not (args.url or args.video_id):
        ap.error('Provide a YouTube URL or --video-id.')
    try:
        result = extract(video_id(args.video_id or args.url), args.languages.split(','))
    except ImportError:
        result = {'error': {'code': 'dependency_missing', 'message': 'python -m pip install -r scripts/requirements.txt 를 먼저 실행해.'}}
    except Exception as e:
        # Do not return upstream bodies, cookies, or exception strings.
        result = {'error': {'code': 'input_unavailable', 'message': f'자막을 가져올 수 없어 ({type(e).__name__}). SRT/VTT 업로드로 전환해. 차단 우회는 시도하지 않아.'}}
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text+'\n', encoding='utf-8')
    else:
        print(text)


if __name__ == '__main__':
    main()
