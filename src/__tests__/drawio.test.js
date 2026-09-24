import { describe, it, expect, afterEach } from 'vitest'
import { drawioToDocument, drawioDocumentFromText, drawioDocumentFromPng } from '../io/importDrawio'
import { importFiles } from '../io/importFile'
import { answerImportChoice } from '../io/importChoice'
import { insertChunk, encodeTextChunk } from '../io/pngChunks'
import { useStore } from '../state/store'
import { createDocument } from '../model/document'
import { tinyPng } from './fixtures'

// What draw.io writes for: a labelled rounded box, an ellipse, an arrow from one
// to the other, and a container holding a rhombus — on a second, hidden layer.
const MODEL = `<mxGraphModel dx="800" dy="600" grid="1" background="#fafafa">
  <root>
    <mxCell id="0"/>
    <mxCell id="1" parent="0"/>
    <mxCell id="a" value="Start&lt;br&gt;here" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" vertex="1" parent="1">
      <mxGeometry x="100" y="100" width="120" height="60" as="geometry"/>
    </mxCell>
    <mxCell id="b" value="End" style="ellipse;whiteSpace=wrap;html=1;" vertex="1" parent="1">
      <mxGeometry x="400" y="100" width="80" height="60" as="geometry"/>
    </mxCell>
    <mxCell id="e" value="" style="endArrow=classic;html=1;" edge="1" parent="1" source="a" target="b">
      <mxGeometry relative="1" as="geometry"/>
    </mxCell>
    <mxCell id="L2" value="Back" parent="0" visible="0"/>
    <object label="Box" id="c">
      <mxCell style="swimlane;" vertex="1" parent="L2">
        <mxGeometry x="100" y="300" width="200" height="120" as="geometry"/>
      </mxCell>
    </object>
    <mxCell id="d" value="?" style="rhombus;" vertex="1" parent="c">
      <mxGeometry x="20" y="40" width="40" height="40" as="geometry"/>
    </mxCell>
  </root>
</mxGraphModel>`

const mxfile = (inner) => `<mxfile host="app.diagrams.net"><diagram name="Main" id="p1">${inner}</diagram></mxfile>`

// draw.io's compressed page: URI-encode, raw-deflate, base64.
async function compress(xml) {
  const stream = new Response(encodeURIComponent(xml)).body.pipeThrough(new CompressionStream('deflate-raw'))
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer())
  return btoa(String.fromCharCode(...bytes))
}

const byName = (doc, name) => Object.values(doc.nodes).find((n) => n.name === name)
const ofType = (doc, type) => Object.values(doc.nodes).filter((n) => n.type === type)

describe('draw.io import', () => {
  it('maps shapes, labels, connectors, layers and containers', async () => {
    const doc = await drawioToDocument(mxfile(MODEL))
    expect(doc.background).toBe('#fafafa')

    // Two layers → two groups, the hidden one still hidden.
    const [front, back] = doc.rootOrder.map((id) => doc.nodes[id])
    expect(front.name).toBe('Layer')
    expect(back).toMatchObject({ name: 'Back', hidden: true })

    // Everything is shifted so the drawing starts at the margin: box a → (20, 20).
    const start = byName(doc, 'Start')
    expect(start.type).toBe('group')
    const [rect, label] = start.children.map((id) => doc.nodes[id])
    expect(rect).toMatchObject({ type: 'rect', x: 20, y: 20, width: 120, height: 60, rx: 9 })
    expect(rect.style).toMatchObject({ fill: '#dae8fc', stroke: '#6c8ebf' })
    expect(label).toMatchObject({ type: 'text', text: 'Start\nhere', align: 'middle', x: 80 })

    const ellipse = ofType(doc, 'ellipse')[0]
    expect(ellipse).toMatchObject({ cx: 360, cy: 50, rx: 40, ry: 30 })
    expect(ellipse.style.fill).toBe('#ffffff')

    // The connector runs from box edge to ellipse edge, arrowhead at the ellipse.
    const edge = byName(doc, 'Connector')
    const [line, arrow] = edge.children.map((id) => doc.nodes[id])
    expect(line.d).toMatch(/^M 140 50 L 3\d\d(\.\d+)? 50$/)
    expect(arrow).toMatchObject({ type: 'polygon', name: 'Arrow' })
    expect(arrow.points[0]).toEqual([320, 50])

    // The container's child sits inside it (offset from the container's origin).
    const box = byName(doc, 'Box')
    expect(box.type).toBe('group')
    const rhombus = ofType(doc, 'polygon').find((n) => n.name === 'Rhombus')
    expect(rhombus.points[0]).toEqual([60, 260])
    expect(doc.nodes[rhombus.parent].parent).toBe(box.id)
  })

  it('reads compressed pages, and stacks several pages as groups', async () => {
    const packed = await compress(MODEL)
    const xml = `<mxfile><diagram name="One">${packed}</diagram><diagram name="Two">${packed}</diagram></mxfile>`
    const doc = await drawioToDocument(xml)
    const [one, two] = doc.rootOrder.map((id) => doc.nodes[id])
    expect([one.name, two.name]).toEqual(['One', 'Two'])
    expect(ofType(doc, 'ellipse')).toHaveLength(2)
    expect(doc.page.height).toBe(20 + 320 + 60 + 320 + 20)
  })

  it('finds the diagram inside .drawio.svg, .drawio.png and HTML exports', async () => {
    const xml = mxfile(MODEL)
    const esc = xml.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${esc}"><rect/></svg>`
    const html = `<html><body><div class="mxgraph" data-mxgraph="${JSON.stringify({ xml }).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></div></body></html>`
    const png = insertChunk(tinyPng(), 'tEXt', encodeTextChunk('mxfile', encodeURIComponent(xml)))

    for (const doc of [await drawioDocumentFromText(svg), await drawioDocumentFromText(html), await drawioDocumentFromPng(png)]) {
      expect(ofType(doc, 'ellipse')).toHaveLength(1)
    }
    expect(await drawioDocumentFromText('<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(null)
    expect(await drawioDocumentFromPng(tinyPng())).toBe(null)
  })

  describe('through importFiles', () => {
    let stop
    afterEach(() => stop?.())

    it('asks open-or-add for a .drawio file and adds its shapes', async () => {
      useStore.getState().loadDocument(createDocument())
      const asked = []
      stop = useStore.subscribe((s) => {
        if (!s.ui.importChoice) return
        asked.push(s.ui.importChoice)
        answerImportChoice('merge')
      })
      await importFiles([new File([mxfile(MODEL)], 'flow.drawio')])
      expect(asked).toEqual([{ name: 'flow.drawio', kind: 'drawio' }])
      expect(ofType(useStore.getState().document, 'ellipse')).toHaveLength(1)
    })

    it('says so when a .xml file holds no diagram', async () => {
      await expect(importFiles([new File(['<note/>'], 'x.xml')])).rejects.toThrow(/no draw.io diagram/)
    })
  })
})
