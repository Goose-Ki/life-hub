import { Area } from '../api'
import { AREAS } from '../utils'

// Область знаний — определяет, какая зона «мозга» растёт от темы или книги.
export function AreaSelect({ value, onChange }: { value: Area; onChange: (a: Area) => void }) {
  return (
    <div className="field">
      <span className="field-label">Область знаний</span>
      <div className="chips">
        {(Object.keys(AREAS) as Area[]).map((a) => (
          <button type="button" key={a} className={`chip area-chip area-${a} ${value === a ? 'active' : ''}`}
            onClick={() => onChange(a)}>{AREAS[a]}</button>
        ))}
      </div>
    </div>
  )
}
