import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/react'
import OptimizeDialog from '../panels/OptimizeDialog'
import { createDocument } from '../model/document'
import { createRect, addNode } from '../model/nodes'
import { serializeDocument } from '../io/serialize'
import * as download from '../io/download'

// jsdom has no Blob URLs; the dialog makes one per preview and revokes it.
beforeAll(() => {
  URL.createObjectURL = () => 'blob:preview'
  URL.revokeObjectURL = () => {}
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})

// jsdom's Blob predates Blob.text().
const readBlob = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.readAsText(blob)
  })

function source() {
  const doc = createDocument()
  const rect = createRect({ x: 12.3456789, y: 20.1234567, width: 200, height: 100 })
  rect.style = { ...rect.style, fill: '#ff0000' }
  addNode(doc, rect)
  return serializeDocument(doc)
}

describe('optimize dialog', () => {
  it('shows the saving and downloads the optimized markup', async () => {
    const svg = source()
    const saved = vi.spyOn(download, 'downloadBlob').mockImplementation(() => {})
    const onClose = vi.fn()
    render(<OptimizeDialog source={svg} filename="drawing.svg" onClose={onClose} />)

    // The percentage only appears once the first optimize pass has resolved.
    const percent = await screen.findByText(/^−\d+\.\d%$/, {}, { timeout: 3000 })
    expect(parseFloat(percent.textContent.slice(1))).toBeGreaterThan(0)

    const button = await waitFor(() => {
      const b = screen.getByRole('button', { name: /Download SVG/ })
      expect(b.disabled).toBe(false)
      return b
    })
    fireEvent.click(button)

    expect(saved).toHaveBeenCalledTimes(1)
    const [blob, filename] = saved.mock.calls[0]
    expect(filename).toBe('drawing.svg')
    expect(await readBlob(blob)).not.toContain('12.3456789')
    expect(onClose).toHaveBeenCalled()
  })

  it('the code view can be switched back to the untouched original', async () => {
    const svg = source()
    render(<OptimizeDialog source={svg} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    await waitFor(() => expect(screen.getByRole('code').textContent).not.toBe(svg))

    fireEvent.click(screen.getByRole('button', { name: 'Original' }))
    expect(screen.getByRole('code').textContent).toBe(svg)
  })

  it('turning a plugin off re-runs and is remembered', async () => {
    render(<OptimizeDialog source={source()} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    await waitFor(() => expect(screen.getByRole('code').textContent).not.toContain('<rect'))

    fireEvent.click(screen.getByLabelText('Shapes to paths'))
    await waitFor(() => expect(screen.getByRole('code').textContent).toContain('<rect'))

    expect(JSON.parse(localStorage.getItem('lulogo.optimize.v1')).plugins.convertShapeToPath).toBe(false)
  })
})
