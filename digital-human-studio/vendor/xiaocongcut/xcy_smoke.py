#!/usr/bin/env python
"""扩展接口冒烟测试：建草稿 → 加花字 → 加音效 → 保存 → 校验草稿内容。

用法：
  .venv/bin/python xcy_smoke.py                 # 用内置音效
  .venv/bin/python xcy_smoke.py /path/to.mp3    # 指定音频
  BASE=http://127.0.0.1:9001 .venv/bin/python xcy_smoke.py

不写进你的项目目录，草稿落在临时目录里，跑完即删。
"""

import glob
import json
import os
import shutil
import sys
import tempfile
import urllib.request

BASE = os.environ.get('BASE', 'http://127.0.0.1:9001')
SFX = os.environ.get(
    'SFX',
    os.path.expanduser('~/Desktop/开发文件/小葱/dsh-newapi-fork/digital-human-studio/assets/sfx/whoosh.wav'),
)


def post(path, payload):
    req = urllib.request.Request(
        BASE + path, data=json.dumps(payload).encode('utf8'),
        headers={'Content-Type': 'application/json'}, method='POST',
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode('utf8'))


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=20) as r:
        return json.loads(r.read().decode('utf8'))


def main():
    audio = sys.argv[1] if len(sys.argv) > 1 else SFX
    idx = get('/xcy')
    print('能力索引:', ', '.join(c['path'] for c in idx['capabilities']))

    work = tempfile.mkdtemp(prefix='xcy-smoke-')
    try:
        made = post('/create_draft', {'width': 1080, 'height': 1920, 'draft_folder': work})
        did = made['output']['draft_id']
        print('草稿:', did)

        text = post('/xcy/add_styled_text', {
            'text': '这批砖别买错', 'style': 'hook_yellow', 'draft_id': did,
            'draft_folder': work, 'start': 0.5, 'end': 2.5,
            'intro': 'Slide_Up', 'intro_duration': 0.45,
        })
        print('花字:', text['style'], text['size'], 'intro=', text['intro'])

        if audio and os.path.exists(audio):
            snd = post('/xcy/add_local_audio', {
                'path': audio, 'draft_id': did, 'draft_folder': work,
                'target_start': 0.5, 'volume': 0.35, 'fade_in': 0.1, 'fade_out': 0.15,
            })
            print('音效:', round(snd['duration'], 2), 's, volume', snd['volume'])
        else:
            print('音效: 跳过（找不到', audio, '）')

        saved = post('/save_draft', {
            'draft_id': did, 'draft_folder': work, 'auto_deploy': False, 'auto_reload': False,
        })
        assert saved.get('success'), saved
        print('保存: OK')

        files = glob.glob(os.path.join(work, '**', 'draft_info.json'), recursive=True)
        assert files, '落盘文件缺失'
        d = json.load(open(files[0], encoding='utf8'))
        m = d['materials']
        ok = True

        images = [v for v in m.get('videos', []) if v.get('type') == 'photo']
        anims = m.get('material_animations', [])
        print('校验 图片:', len(images), '| 动画:', len(anims))
        ok &= len(images) >= 1 and len(anims) >= 1

        audios = m.get('audios', [])
        seg_vol = [
            s.get('volume') for t in d['tracks'] if t['type'] == 'audio' for s in t['segments']
        ]
        print('校验 音频:', len(audios), '| 片段音量:', seg_vol)
        ok &= len(audios) >= 1 and any(v is not None for v in seg_vol)

        print('\n结果:', 'PASS' if ok else 'FAIL')
        return 0 if ok else 1
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
