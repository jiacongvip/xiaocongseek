#!/usr/bin/env python3
"""音效合成器 — 移植自「v4 写实包装」套件的 audio.py。

为什么自己合成而不是找现成素材：v4 那套 22 个音效全部是 numpy 合成的，
没有采样文件，**没有版权问题**，而且音色是配着那套动效调过的。

这个脚本只做一件事：把 LIB 里的音效各存一个 wav，不混音、不依赖 meta.json。
混音（按时间点铺音效轨）是 digital-human-studio 那边的事。

用法：
    python scripts/gen-sfx.py                    # 输出到 assets/sfx
    python scripts/gen-sfx.py /tmp/out           # 输出到别处

改动注意：
- 生成顺序会影响噪声内容（共用同一个 rng 流），**不要随便调换**，否则音色会变。
- 各音效的 `norm(x, g)` 里那个 g 是设计好的相对响度（blip 就该比 hit 轻），别统一归一化。
"""
import json
import os
import sys
import wave

import numpy as np

SR = 48000
rng = np.random.default_rng(3)


def env_exp(n, k):
    return np.exp(-np.arange(n) / SR * k)


def onepole_lp(x, fc):
    """时变一阶低通；fc 可以是数组。"""
    fc = np.broadcast_to(np.asarray(fc, float), x.shape)
    a = np.exp(-2 * np.pi * fc / SR)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a[i]) * x[i] + a[i] * acc
        y[i] = acc
    return y


def hp(x):
    return np.diff(x, prepend=0)


def sine_sweep(f0, f1, d, k):
    n = int(d * SR)
    f = np.geomspace(f0, f1, n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env_exp(n, k)


def noise(d):
    return rng.standard_normal(int(d * SR))


def bell(n, pk=0.5):
    x = np.linspace(0, 1, n)
    return np.where(x < pk, (x / pk) ** 2, ((1 - x) / (1 - pk)) ** 1.5)


def norm(x, g=1.0):
    return x / (np.abs(x).max() + 1e-9) * g


def whoosh(d=0.4, f0=300, f1=4000, pk=0.6):
    n = int(d * SR)
    k = int(n * pk)
    fc = np.concatenate([np.geomspace(f0, f1, k), np.geomspace(f1, f0, n - k)])
    x = onepole_lp(noise(d), fc)
    x = onepole_lp(x, fc)
    return norm(x * bell(n, pk), 0.8)


def build_library():
    """按 v4 原顺序合成，顺序影响 rng，别改。"""
    lib = {}
    lib['whoosh'] = whoosh(0.42, 250, 3500, 0.62)
    lib['swoosh'] = whoosh(0.28, 600, 6000, 0.45) * 0.8
    lib['suck'] = whoosh(0.5, 200, 3000, 0.9)
    lib['send'] = whoosh(0.25, 1000, 8000, 0.3)

    h = sine_sweep(150, 42, 0.7, 6) * 1.0
    h[:int(0.012 * SR)] += noise(0.012) * 0.6 * np.linspace(1, 0, int(0.012 * SR))
    lib['hit'] = norm(np.tanh(h * 1.6), 0.95)

    lib['pop'] = norm(sine_sweep(500, 1300, 0.09, 40), 0.6)
    lib['blip'] = norm(sine_sweep(1500, 1700, 0.05, 70), 0.45)

    t = noise(0.006) * np.linspace(1, 0, int(0.006 * SR))
    lib['tick'] = norm(hp(t), 0.5)

    ty = sine_sweep(2400, 2000, 0.02, 200) * 0.3
    ty[:int(0.004 * SR)] += hp(noise(0.004)) * np.linspace(1, 0, int(0.004 * SR))
    lib['type'] = norm(ty, 0.5)

    lib['cut'] = norm(
        hp(noise(0.03)) * env_exp(int(0.03 * SR), 150) + sine_sweep(900, 600, 0.03, 120) * 0.5, 0.55
    )

    ck = sine_sweep(3000, 2500, 0.015, 300) * 0.4
    ck[:int(0.01 * SR)] += hp(noise(0.01)) * env_exp(int(0.01 * SR), 400)
    lib['click'] = norm(ck, 0.6)

    c = hp(noise(0.12)) * env_exp(int(0.12 * SR), 45)
    c[:len(sine_sweep(220, 120, 0.12, 30))] += sine_sweep(220, 120, 0.12, 30) * 0.8
    lib['clap'] = norm(c, 0.95)

    st = sine_sweep(110, 60, 0.35, 12)
    st[:int(0.06 * SR)] += onepole_lp(noise(0.06), 2500) * 3 * np.linspace(1, 0, int(0.06 * SR))
    lib['stamp'] = norm(np.tanh(st * 2), 0.95)

    r = noise(0.4)
    am = (rng.random(int(0.4 * SR) // 300 + 1) > 0.45).repeat(300)[:int(0.4 * SR)] * 1.0
    lib['rip'] = norm(onepole_lp(hp(r), 5000) * am * bell(int(0.4 * SR), 0.15), 0.8)

    d = np.zeros(int(0.9 * SR))
    for f, g in ((1318.5, 1.0), (1975.5, 0.6), (2637, 0.25)):
        d += np.sin(2 * np.pi * f * np.arange(len(d)) / SR) * g * env_exp(len(d), 5)
    d[:200] *= np.linspace(0, 1, 200)
    lib['ding'] = norm(d, 0.5)

    sp = np.zeros(int(0.5 * SR))
    for k in range(7):
        o = int(k * 0.05 * SR)
        b = sine_sweep(rng.uniform(2500, 5000), rng.uniform(2500, 5000), 0.12, 30)
        sp[o:o + len(b)] += b * (1 - k / 8)
    lib['sparkle'] = norm(sp, 0.45)

    er = np.sign(np.sin(2 * np.pi * 110 * np.arange(int(0.28 * SR)) / SR)) * env_exp(int(0.28 * SR), 6)
    er[int(0.13 * SR):int(0.15 * SR)] = 0
    lib['error'] = norm(onepole_lp(er, 1800), 0.6)

    g = np.zeros(int(0.2 * SR))
    for k in range(8):
        o = int(rng.uniform(0, 0.17) * SR)
        L = int(rng.uniform(0.01, 0.03) * SR)
        g[o:o + L] += np.repeat(rng.standard_normal(L // 40 + 1), 40)[:len(g[o:o + L])]
    lib['glitch'] = norm(onepole_lp(g, 6000), 0.55)

    n = int(0.6 * SR)
    lib['riser'] = norm(
        onepole_lp(noise(0.6), np.geomspace(200, 7000, n)) * np.linspace(0, 1, n) ** 2
        + np.sin(2 * np.pi * np.cumsum(np.geomspace(200, 900, n)) / SR) * np.linspace(0, 1, n) ** 2 * 0.3,
        0.7,
    )

    n = int(0.45 * SR)
    lib['rewind'] = norm(
        np.sin(
            2 * np.pi * np.cumsum(np.geomspace(1400, 300, n) * (1 + 0.3 * np.sin(np.arange(n) / SR * 60))) / SR
        ) * bell(n, 0.2),
        0.35,
    )

    n = int(0.5 * SR)
    dr = (
        onepole_lp(noise(0.5), 900) * bell(n, 0.3)
        + np.sin(2 * np.pi * np.cumsum(np.linspace(180, 140, n)) / SR) * bell(n, 0.3) * 0.3
    )
    lib['door'] = norm(dr, 0.6)

    o = sine_sweep(100, 38, 1.5, 3) + np.pad(lib['ding'], (0, int(1.5 * SR) - len(lib['ding']))) * 0.4
    lib['outro'] = norm(o, 0.8)

    # 五声音阶软铃（木槌感），用于正面提示
    for k, f in enumerate((784.0, 880.0, 1046.5, 1174.7, 1318.5)):
        n = int(0.7 * SR)
        tt = np.arange(n) / SR
        x = np.sin(2 * np.pi * f * tt) * np.exp(-tt * 7) + 0.35 * np.sin(2 * np.pi * f * 3.98 * tt) * np.exp(-tt * 22)
        x[:120] *= np.linspace(0, 1, 120)
        lib[f'n{k + 1}'] = norm(x, 0.5)

    # ---------- 以下为补充（v4 没有，按讲解片实际缺口加的）----------
    # 注意：全部加在最后，不要插到上面去——前面共用 rng 流，插队会改掉原有 27 个音色。

    # 数字滚动上升：一串快速递升短音，像计数器在跳
    n = int(0.55 * SR)
    cnt = np.zeros(n)
    steps = 9
    for k in range(steps):
        o = int(k * (0.42 / steps) * SR)
        f = 520 + k * 95
        L = int(0.05 * SR)
        seg = np.sin(2 * np.pi * f * np.arange(L) / SR) * env_exp(L, 70)
        end = min(n, o + L)
        cnt[o:end] += seg[:end - o] * (0.45 + 0.55 * k / steps)
    lib['count'] = norm(cnt, 0.5)

    # 进度条走满：0.52s 上行滑音渐强，0.5s 处叠一声 ding，末尾淡出。
    # 长度必须给 ding 留够衰减时间，否则结尾被截断成一声"啪"。
    n = int(0.92 * SR)
    sw = int(0.52 * SR)
    fs = np.geomspace(300, 1150, sw)
    prg = np.zeros(n)
    prg[:sw] = np.sin(2 * np.pi * np.cumsum(fs) / SR) * np.linspace(0, 1, sw) ** 0.8 * 0.8
    tail = lib['ding'][:int(0.42 * SR)]
    od = int(0.50 * SR)
    prg[od:od + len(tail)] += tail[:n - od] * 0.9
    fade = int(0.10 * SR)
    prg[-fade:] *= np.linspace(1, 0, fade)
    lib['progress'] = norm(prg, 0.55)

    # 打勾：两段上扬短音，第二声更高更长
    n = int(0.32 * SR)
    chk = np.zeros(n)
    a = sine_sweep(880, 1320, 0.07, 45)
    b = sine_sweep(1320, 1860, 0.18, 22)
    chk[:len(a)] += a * 0.6
    ob = int(0.07 * SR)
    chk[ob:ob + len(b)] += b[:n - ob] * 0.75
    lib['check'] = norm(chk, 0.5)

    # 开关：高低两声短促咔嗒
    n = int(0.17 * SR)
    tg = np.zeros(n)
    for k, (f0, f1, g) in enumerate(((2300, 1700, 0.55), (1500, 1050, 0.75))):
        L = int(0.011 * SR)
        c = hp(noise(0.011)) * env_exp(L, 480) + sine_sweep(f0, f1, 0.011, 380) * 0.5
        o = int(k * 0.062 * SR)
        tg[o:o + L] += c[:n - o] * g
    # hp() 会给首样本一个突跳，起手 1.5ms 淡入压掉，否则扬声器上会"咔"一下。
    fi = int(0.0015 * SR)
    tg[:fi] *= np.linspace(0, 1, fi)
    lib['toggle'] = norm(tg, 0.5)

    # 低频垫音：可无缝循环。所有频率在 2s 内都是整数周期，首尾相接不爆音。
    n = int(2.0 * SR)
    tt = np.arange(n) / SR
    lfo = 0.75 + 0.25 * np.sin(2 * np.pi * 0.5 * tt - np.pi / 2)
    pad = (np.sin(2 * np.pi * 110 * tt) * 0.55
           + np.sin(2 * np.pi * 165 * tt) * 0.25
           + np.sin(2 * np.pi * 55 * tt) * 0.35) * lfo
    lib['pad_low'] = norm(pad, 0.34)

    # 等待循环：1.5s 内三声柔和脉冲，最后一个衰减完再回到开头
    n = int(1.5 * SR)
    ld = np.zeros(n)
    for k in range(3):
        o = int(k * 0.5 * SR)
        L = int(0.35 * SR)
        fr = 640 + k * 85
        seg = np.sin(2 * np.pi * fr * np.arange(L) / SR) * env_exp(L, 13)
        ld[o:o + L] += seg * (0.9 - 0.15 * k)
    ld[-int(0.08 * SR):] *= np.linspace(1, 0, int(0.08 * SR))
    lib['loading'] = norm(ld, 0.36)

    return lib


# 用途与建议增益：给 AI 排片时按「这一下要表达什么」挑，不要按名字猜。
USAGE = {
    'whoosh': ('卡片滑入、版面整体切走', 0.28),
    'swoosh': ('轻量滑动、标签掠过', 0.22),
    'suck': ('吸进/收拢，元素被吸走', 0.26),
    'send': ('信息发出、推送', 0.28),
    'hit': ('重音落地，强调一句话', 0.32),
    'pop': ('小元素弹出、数字跳动', 0.20),
    'blip': ('轻提示、计数器变化', 0.16),
    'tick': ('计时、进度推进', 0.14),
    'type': ('打字、代码逐字出现', 0.18),
    'cut': ('切断、切换镜头', 0.22),
    'click': ('点击、选中', 0.18),
    'clap': ('拍手、收尾强调', 0.30),
    'stamp': ('印章砸下、结论定版', 0.34),
    'rip': ('撕开、揭晓前后对比', 0.24),
    'ding': ('正确答案、达成', 0.22),
    'sparkle': ('闪光、亮点强调', 0.18),
    'error': ('报错、否定、踩坑', 0.26),
    'glitch': ('故障、数据异常', 0.22),
    'riser': ('蓄势、进入高潮前 1 秒', 0.26),
    'rewind': ('倒回、重来一次', 0.20),
    'door': ('开门、进入场景', 0.24),
    'outro': ('结尾收束，全片只用一次', 0.30),
    'n1': ('正面提示，音阶第 1 级', 0.18),
    'n2': ('正面提示，音阶第 2 级', 0.18),
    'n3': ('正面提示，音阶第 3 级', 0.18),
    'n4': ('正面提示，音阶第 4 级', 0.18),
    'n5': ('正面提示，音阶第 5 级', 0.18),
    'count': ('数字滚动上升，讲数据/统计', 0.22),
    'progress': ('进度条走满、从 A 走到 B', 0.24),
    'check': ('打勾、清单逐项完成', 0.20),
    'toggle': ('开关切换、参数开关', 0.18),
    'pad_low': ('低频垫音，讲解板满屏时压场（可循环）', 0.14),
    'loading': ('等待提示（可循环）', 0.16),
}


def write_wav(path, x, sr=SR):
    # 不再二次归一化：各音效的 norm(g) 已经定好相对响度，统一拉平会把 blip 抬得和 hit 一样响。
    pcm = np.clip(x, -1.0, 1.0)
    data = (pcm * 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(data.tobytes())


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(root, 'assets', 'sfx')
    os.makedirs(out, exist_ok=True)

    lib = build_library()
    items = []
    for name, data in lib.items():
        write_wav(os.path.join(out, f'{name}.wav'), data)
        use, gain = USAGE.get(name, ('', 0.25))
        items.append({
            'id': name,
            'file': f'{name}.wav',
            'dur': round(len(data) / SR, 3),
            'peak': round(float(np.abs(data).max()), 3),
            'use': use,
            'gain': gain,
        })

    manifest = {'sampleRate': SR, 'channels': 1, 'count': len(items), 'items': items}
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    total = sum(i['dur'] for i in items)
    print(f'{len(items)} 个音效 → {out}')
    print(f'总时长 {total:.1f}s，最长 {max(i["dur"] for i in items)}s')
    for i in items:
        print(f"  {i['id']:<8} {i['dur']:>5.2f}s  gain {i['gain']:.2f}  {i['use']}")


if __name__ == '__main__':
    main()
