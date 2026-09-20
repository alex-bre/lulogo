import { useEffect, useState } from 'react'
import styles from './Controls.module.css'

/* A labelled row: label on the left, control(s) on the right. */
export function Field({ label, children }) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.control}>{children}</div>
    </div>
  )
}

/* Section heading inside a tab. */
export function Group({ title, children, right }) {
  return (
    <section className={styles.group}>
      {title && (
        <div className={styles.groupHead}>
          <h3 className={styles.groupTitle}>{title}</h3>
          {right}
        </div>
      )}
      <div className={styles.groupBody}>{children}</div>
    </section>
  )
}

const display = (v) => (v == null || Number.isNaN(v) ? '' : String(Math.round(v * 100) / 100))

/**
 * Numeric input that commits on Enter/blur and supports arrow-key nudging
 * (Shift = ×10). A null value renders blank (e.g. mixed multi-selection).
 */
export function NumberInput({ value, onChange, min, max, step = 1, disabled, placeholder = '—', title }) {
  const [text, setText] = useState(display(value))
  useEffect(() => setText(display(value)), [value])

  const clamp = (n) => {
    if (min != null) n = Math.max(min, n)
    if (max != null) n = Math.min(max, n)
    return n
  }
  const commit = () => {
    const n = parseFloat(text)
    if (!Number.isNaN(n)) onChange(clamp(n))
    else setText(display(value))
  }

  return (
    <input
      className={styles.input}
      type="text"
      inputMode="decimal"
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      title={title}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
          e.target.blur()
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          onChange(clamp((value || 0) + (e.shiftKey ? 10 : step)))
        } else if (e.key === 'ArrowDown') {
          e.preventDefault()
          onChange(clamp((value || 0) - (e.shiftKey ? 10 : step)))
        }
      }}
      onBlur={commit}
    />
  )
}

/**
 * Solid color control: swatch (opens native picker) + hex field. With
 * `allowNone`, a button clears the value to null ("none").
 */
export function ColorInput({ value, onChange, allowNone }) {
  const isNone = value == null || value === 'none'
  const isGradient = typeof value === 'string' && value.startsWith('url(')
  const color = !isNone && !isGradient && value.startsWith('#') ? value : '#000000'

  return (
    <div className={styles.colorRow}>
      <span className={styles.swatchWrap}>
        <span
          className={styles.swatch}
          data-none={isNone || undefined}
          style={isNone || isGradient ? undefined : { background: color }}
        />
        {!isGradient && (
          <input
            className={styles.colorPicker}
            type="color"
            value={color}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </span>
      <input
        className={styles.hex}
        type="text"
        value={isGradient ? 'gradient' : isNone ? '' : value}
        placeholder="none"
        disabled={isGradient}
        onChange={(e) => {
          const v = e.target.value.trim()
          onChange(v === '' ? null : v)
        }}
      />
      {allowNone && (
        <button
          className={styles.iconBtn}
          title="No paint"
          data-active={isNone || undefined}
          onClick={() => onChange(null)}
        >
          ∅
        </button>
      )}
    </div>
  )
}

/* Small on/off switch. */
export function Toggle({ checked, onChange, title, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      className={styles.toggle}
      data-on={checked || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  )
}

/* Generic icon button (optionally toggled-active). */
export function IconButton({ title, onClick, active, disabled, children }) {
  return (
    <button
      type="button"
      className={styles.iconBtn}
      title={title}
      onClick={onClick}
      disabled={disabled}
      data-active={active || undefined}
    >
      {children}
    </button>
  )
}

/* Row of icon buttons sharing a bordered container. */
export function IconRow({ children }) {
  return <div className={styles.iconRow}>{children}</div>
}

/* Dropdown. options: [{ value, label }] */
export function Select({ value, onChange, options, disabled }) {
  return (
    <select
      className={styles.select}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => {
        const opt = options.find((o) => String(o.value) === e.target.value)
        onChange(opt ? opt.value : e.target.value)
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

/* Slider. */
export function Range({ value, onChange, min = 0, max = 1, step = 0.01 }) {
  return (
    <input
      className={styles.range}
      type="range"
      min={min}
      max={max}
      step={step}
      value={value ?? 1}
      onChange={(e) => onChange(parseFloat(e.target.value))}
    />
  )
}
