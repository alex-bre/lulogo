import { useState } from 'react'
import { useStore } from '../../../state/store'
import { move3DDelta } from '../../../model/projection3d'
import { Field, Group, NumberInput, Range } from '../../common/Controls'
import styles from './ArrangeTab.module.css'

const round2 = (n) => Math.round(n * 100) / 100

/**
 * "Move in 3D" — translate the selection by a distance along a 3D direction,
 * aimed with the same Tilt/Turn angles as the 3D transform. The direction is
 * the depth axis projected in parallel to the canvas, so tilting/turning swings
 * the move into view (foreshortened). It's a plain translate: one undo step.
 */
export default function Move3DSection() {
  const selection = useStore((s) => s.selection)
  const translateNodes = useStore((s) => s.translateNodes)

  const [distance, setDistance] = useState(10)
  const [tilt, setTilt] = useState(0) // about X
  const [turn, setTurn] = useState(0) // about Y

  const [dx, dy] = move3DDelta(distance, tilt, turn)
  const canMove = selection.length > 0 && (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6)

  return (
    <Group title="Move in 3D">
      <Field label="Distance">
        <NumberInput value={distance} step={1} onChange={setDistance} />
      </Field>
      <Field label="Tilt X">
        <Range min={-180} max={180} step={1} value={tilt} onChange={setTilt} />
        <div className={styles.num}>
          <NumberInput value={tilt} min={-180} max={180} onChange={setTilt} />
        </div>
      </Field>
      <Field label="Turn Y">
        <Range min={-180} max={180} step={1} value={turn} onChange={setTurn} />
        <div className={styles.num}>
          <NumberInput value={turn} min={-180} max={180} onChange={setTurn} />
        </div>
      </Field>
      <div className={styles.actions3d}>
        <button className={styles.applyBtn} disabled={!canMove} onClick={() => translateNodes(selection, dx, dy)}>
          Move
        </button>
      </div>
      <p className={styles.hint3d}>
        Moves {distance} units along the depth direction aimed by Tilt/Turn — on-screen Δ {round2(dx)}, {round2(dy)} px.
        At 0°/0° the direction points into the screen (no visible move); tilt or turn to swing it into view.
      </p>
    </Group>
  )
}
