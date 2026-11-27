import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'music')
const sr = 44100
const seconds = 20

function render(fill) {
  const samples = new Float64Array(sr * seconds)
  fill(samples)
  let peak = 0
  for (const value of samples) peak = Math.max(peak, Math.abs(value))
  const gain = peak > 0 ? 0.72 / peak : 1
  const fade = Math.floor(sr * 0.35)
  for (let i = 0; i < samples.length; i++) {
    let edge = 1
    if (i < fade) edge = i / fade
    else if (i > samples.length - fade) edge = (samples.length - i) / fade
    samples[i] *= gain * edge
  }
  return samples
}

function addTone(samples, start, dur, freq, amp, decay) {
  const a0 = Math.max(0, Math.floor(start * sr))
  const a1 = Math.min(samples.length, Math.floor((start + dur) * sr))
  for (let i = a0; i < a1; i++) {
    const t = (i - a0) / sr
    const attack = Math.min(1, t / 0.01)
    const body = Math.sin(2 * Math.PI * freq * t)
    const bright = 0.22 * Math.sin(2 * Math.PI * freq * 2 * t)
    samples[i] += amp * attack * Math.exp(-t * decay) * (body + bright)
  }
}

function addNoise(samples, start, dur, amp) {
  const a0 = Math.max(0, Math.floor(start * sr))
  const a1 = Math.min(samples.length, Math.floor((start + dur) * sr))
  let prev = 0
  for (let i = a0; i < a1; i++) {
    const t = (i - a0) / sr
    prev = prev * 0.55 + (Math.random() * 2 - 1) * 0.45
    samples[i] += amp * Math.exp(-t * 70) * prev
  }
}

function addPad(samples, start, dur, freq, amp) {
  const a0 = Math.max(0, Math.floor(start * sr))
  const a1 = Math.min(samples.length, Math.floor((start + dur) * sr))
  for (let i = a0; i < a1; i++) {
    const t = (i - a0) / sr
    const edge = Math.min(1, t / 0.7, (dur - t) / 0.9)
    const wobble = 0.9 + 0.1 * Math.sin(2 * Math.PI * 0.2 * (start + t))
    const tone = Math.sin(2 * Math.PI * freq * t) + 0.4 * Math.sin(2 * Math.PI * freq * 1.004 * t)
    samples[i] += amp * Math.max(0, edge) * wobble * tone
  }
}

function lively(samples) {
  const chords = [
    [261.63, 329.63, 392],
    [196, 246.94, 392],
    [220, 261.63, 329.63],
    [174.61, 220, 349.23],
  ]
  const melody = [523.25, 587.33, 659.25, 523.25, 392, 440, 523.25, 329.63]
  const beat = 60 / 104
  for (let bar = 0; bar < 9; bar++) {
    const chord = chords[bar % chords.length]
    const barStart = bar * beat * 4
    for (const hit of [0, 2]) {
      chord.forEach((freq, index) => {
        addTone(samples, barStart + hit * beat + index * 0.02, 0.42, freq, 0.12, 5.2)
      })
    }
    for (let step = 0; step < 4; step++) {
      addTone(samples, barStart + step * beat, 0.3, chord[0] / 2, 0.16, 8)
      addNoise(samples, barStart + step * beat, 0.04, step % 2 ? 0.025 : 0.05)
      addNoise(samples, barStart + step * beat + beat / 2, 0.03, 0.03)
    }
    for (let step = 0; step < 8; step++) {
      const note = melody[(bar * 2 + step) % melody.length]
      addTone(samples, barStart + step * beat / 2, 0.18, note, 0.045, 9)
    }
  }
}

function steady(samples) {
  const chords = [
    [130.81, 164.81, 196, 246.94],
    [110, 130.81, 164.81, 220],
    [87.31, 110, 130.81, 174.61],
    [98, 123.47, 146.83, 196],
  ]
  const chordDur = seconds / chords.length
  chords.forEach((chord, index) => {
    const start = index * chordDur
    chord.forEach(freq => addPad(samples, start, chordDur + 0.4, freq, 0.11))
    addPad(samples, start, chordDur + 0.4, chord[2] * 2, 0.03)
  })
}

function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(Math.round(value * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sr, 24)
  header.writeUInt32LE(sr * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  writeFileSync(path, Buffer.concat([header, data]))
}

mkdirSync(root, { recursive: true })
for (const [name, fill] of [['lively', lively], ['steady', steady]]) {
  const wav = join(root, `${name}.wav`)
  const mp3 = join(root, `${name}.mp3`)
  writeWav(wav, render(fill))
  const raw = join(root, `${name}.raw.mp3`)
  execFileSync('ffmpeg', ['-y', '-i', wav, '-codec:a', 'libmp3lame', '-qscale:a', '5', raw], { stdio: 'ignore' })
  execFileSync('ffmpeg', ['-y', '-i', raw, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-codec:a', 'libmp3lame', '-qscale:a', '4', mp3], { stdio: 'ignore' })
  rmSync(raw)
  rmSync(wav)
  console.log(mp3)
}
