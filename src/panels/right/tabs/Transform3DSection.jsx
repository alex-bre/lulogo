import { useRef } from 'react'
import { useStore } from '../../../state/store'
import { buildT3DSession } from '../../../model/transform3d'
import { T3D_DEFAULTS, ISO_PRESETS, isIdentityT3D, wrapAngle } from '../../../model/projection3d'
import { Field, Group, NumberInput, Range, Toggle } from '../../common/Controls'
import styles from './ArrangeTab.module.css'

const AXES = [
  { key: 'rx', label: 'Tilt X' },
  { key: 'ry', label: 'Turn Y' },
  { key: 'rz', label: 'Spin Z' },
]

/**
 * "3D transform" section of the Arrange tab. Touching any control starts a
 * live preview session on the canvas (see Transform3DLayer): the selection is
 * shown projected inside an orbitable cube. Apply bakes the projection into
 * the geometry (one undo step); Cancel/Esc discards it.
 */
export default function Transform3DSection({ leaves }) {
  const t3d = useStore((s) => s.ui.t3d)
  const setT3DParams = useStore((s) => s.setT3DParams)
  const cancelT3D = useStore((s) => s.cancelT3D)
  const applyT3D = useStore((s) => s.applyT3D)
  const building = useRef(false)

  const projectable = leaves.filter((n) => !n.locked)
  const images = projectable.filter((n) => n.type === 'image').length
  const texts = projectable.filter((n) => n.type === 'text').length

  const params = t3d ? t3d.params : T3D_DEFAULTS

  // First touch of any control builds the session (text is outlined async),
  // then every change just updates the previewed parameters.
  const change = (partial) => {
    if (t3d) return setT3DParams(partial)
    if (building.current) return
    building.current = true
    const st = useStore.getState()
    const sel = st.selection
    buildT3DSession(st.document, sel)
      .then((session) => {
        building.current = false
        if (!session || useStore.getState().selection !== sel) return
        useStore.getState().startT3D(session)
        useStore.getState().setT3DParams(partial)
      })
      .catch(() => {
        building.current = false
      })
  }

  if (!projectable.length) {
    return (
      <Group title="3D transform">
        <p className={styles.hint3d}>Nothing selectable to transform — locked objects are skipped.</p>
      </Group>
    )
  }

  const ortho = params.projection !== 'perspective'
  return (
    <Group title="3D transform">
      <Field label="Projection">
        <div className={styles.seg}>
          <button
            data-active={ortho || undefined}
            title="Orthographic / isometric — parallel edges stay parallel"
            onClick={() => change({ projection: 'orthographic' })}
          >
            Ortho
          </button>
          <button
            data-active={!ortho || undefined}
            title="Perspective — edges converge with depth"
            onClick={() => change({ projection: 'perspective' })}
          >
            Persp
          </button>
        </div>
      </Field>

      {!ortho && (
        <Field label="Strength">
          <Range min={0} max={100} step={1} value={params.perspective} onChange={(v) => change({ perspective: v })} />
          <div className={styles.num}>
            <NumberInput
              value={params.perspective}
              min={0}
              max={100}
              title="How strongly edges converge (camera distance)"
              onChange={(v) => change({ perspective: v })}
            />
          </div>
        </Field>
      )}

      {AXES.map(({ key, label }) => (
        <Field key={key} label={label}>
          <Range min={-180} max={180} step={1} value={params[key]} onChange={(v) => change({ [key]: v })} />
          <div className={styles.num}>
            <NumberInput value={params[key]} min={-180} max={180} onChange={(v) => change({ [key]: wrapAngle(v) })} />
          </div>
        </Field>
      ))}

      <Field label="Thickness">
        <Range min={0} max={300} step={1} value={params.depth || 0} onChange={(v) => change({ depth: v })} />
        <div className={styles.num}>
          <NumberInput
            value={params.depth || 0}
            min={0}
            title="Extrude the shape into a solid block of this depth (rotate to see the thickness)"
            onChange={(v) => change({ depth: Math.max(0, v) })}
          />
        </div>
      </Field>

      {params.depth > 0 && (
        <>
          <Field label="Taper">
            <Range min={0} max={1} step={0.01} value={params.taper || 0} onChange={(v) => change({ taper: v })} />
            <div className={styles.num}>
              <NumberInput
                value={Math.round((params.taper || 0) * 100)}
                min={0}
                max={100}
                title="Shrink the shape toward the back as it recedes (0 = straight sides, 100% = pointed)"
                onChange={(v) => change({ taper: Math.max(0, Math.min(1, v / 100)) })}
              />
            </div>
          </Field>
          <Field label="Flat color">
            <Toggle
              checked={!!params.flatShade || !!params.simple}
              disabled={!!params.simple}
              onChange={(v) => change({ flatShade: v })}
              title="Fill the whole block with one flat colour instead of shading each face"
            />
          </Field>
          <Field label="Simplified">
            <Toggle
              checked={!!params.simple}
              onChange={(v) => change(v ? { simple: true, flatShade: true } : { simple: false })}
              title="Convex shortcut — build the thickness as a single convex body layer instead of one face per edge (best for convex shapes; forces flat colour)"
            />
          </Field>
        </>
      )}

      {ortho && (
        <Field label="Isometric">
          <div className={styles.seg}>
            <button title="Isometric top face" onClick={() => change({ ...ISO_PRESETS.top })}>
              Top
            </button>
            <button title="Isometric left face" onClick={() => change({ ...ISO_PRESETS.left })}>
              Left
            </button>
            <button title="Isometric right face" onClick={() => change({ ...ISO_PRESETS.right })}>
              Right
            </button>
          </div>
        </Field>
      )}

      {t3d && (
        <>
          <div className={styles.actions3d}>
            <button className={styles.applyBtn} disabled={isIdentityT3D(params) && !(params.depth > 0)} onClick={applyT3D}>
              Apply
            </button>
            <button
              className={styles.ghostBtn}
              onClick={() => setT3DParams({ rx: 0, ry: 0, rz: 0, depth: 0, taper: 0 })}
              title="Reset the angles and thickness (keeps the projection mode)"
            >
              Reset
            </button>
            <button className={styles.ghostBtn} onClick={cancelT3D}>
              Cancel
            </button>
          </div>
          <p className={styles.hint3d}>
            Drag the cube on the canvas to orbit — Shift snaps to 15°, Alt spins. Enter applies, Esc cancels.
            {texts > 0 && ' Text is applied as outlines.'}
            {images > 0 && !ortho && ` ${images} image${images > 1 ? 's' : ''} stay flat in perspective.`}
          </p>
        </>
      )}
    </Group>
  )
}
