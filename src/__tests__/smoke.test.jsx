import { describe, it, expect } from 'vitest'
import { renderToString } from 'react-dom/server'
import App from '../App'
import StyleTab from '../panels/right/tabs/StyleTab'
import ArrangeTab from '../panels/right/tabs/ArrangeTab'
import { useStore } from '../state/store'

// Renders the whole component tree once. Effects don't run under SSR, so this
// specifically catches render-time errors: bad imports, undefined access, and
// invalid JSX across every panel and the canvas.
describe('App smoke test', () => {
  it('renders the full tree without throwing', () => {
    let html = ''
    expect(() => {
      html = renderToString(<App />)
    }).not.toThrow()
    expect(html).toContain('Lulogo')
    expect(html).toContain('<svg')
  })

  it('renders the Style and Arrange tabs with a selection', () => {
    const id = useStore.getState().document.rootOrder[0]
    useStore.setState({ selection: [id] })
    expect(() =>
      renderToString(
        <>
          <StyleTab />
          <ArrangeTab />
        </>,
      ),
    ).not.toThrow()
  })
})
