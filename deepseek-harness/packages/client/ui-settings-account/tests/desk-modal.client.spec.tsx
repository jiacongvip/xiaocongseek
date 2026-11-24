// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/client/DigitalHumanPanel.module.css', () => {
  const classes = new Proxy({}, { get: (_target, key) => (typeof key === 'string' ? key : 'css') })
  return { default: classes, __esModule: true }
})

import { DigitalHumanDeskModal } from '../src/client/DigitalHumanDeskModal.tsx'

afterEach(() => cleanup())

function Harness({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>打开</button>
      <DigitalHumanDeskModal open={open} title="下载没成功" onClose={() => setOpen(false)}>
        <p>请再试一次</p>
        <button type="button">再试一次</button>
      </DigitalHumanDeskModal>
    </div>
  )
}

describe('DigitalHumanDeskModal', () => {
  it('stays closed until open, then exposes a labelled dialog', () => {
    render(<Harness startOpen={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByRole('heading', { name: '下载没成功' })).toBeTruthy()
    expect(screen.getByLabelText('关闭')).toBeTruthy()
  })

  it('closes on overlay, Escape, and the close button, but not on content clicks', () => {
    render(<Harness />)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByText('请再试一次'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '再试一次' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()

    render(<Harness />)
    const overlay = document.querySelector('[data-desk-modal-overlay]') as HTMLElement
    fireEvent.click(overlay)
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()

    render(<Harness />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('restores focus to the opener after close and never uses alert', () => {
    const alertSpy = vi.spyOn(window, 'alert')
    render(<Harness startOpen={false} />)
    const opener = screen.getByRole('button', { name: '打开' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('关闭'))
    expect(document.activeElement).toBe(opener)
    expect(alertSpy).not.toHaveBeenCalled()
    alertSpy.mockRestore()
  })
})
