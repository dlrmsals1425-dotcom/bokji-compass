"use client";
import { useId } from "react";

export interface Opt<V extends string | number> {
  value: V;
  label: string;
}

/** 단일 선택 (라디오) + '모름' */
export function RadioGroup<V extends string | number>(props: {
  legend: string;
  hint?: string;
  options: Opt<V>[];
  value: V | "unknown";
  onChange: (v: V | "unknown") => void;
  unknownLabel?: string;
  /** false 이면 '모름' 선택지를 숨김 (작성자 역할 등) */
  showUnknown?: boolean;
  name: string;
}) {
  const id = useId();
  const { legend, hint, options, value, onChange, unknownLabel = "모름 / 건너뛰기", showUnknown = true, name } = props;
  return (
    <fieldset className="field" aria-describedby={hint ? `${id}-h` : undefined}>
      <legend>{legend}</legend>
      {hint && (
        <p className="hint" id={`${id}-h`}>
          {hint}
        </p>
      )}
      <div className="opts">
        {options.map((o) => (
          <label className="opt" key={String(o.value)}>
            <input type="radio" name={name} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
        {showUnknown && (
          <>
            <p className="or" aria-hidden="true">
              또는
            </p>
            <label className="opt unknown">
              <input type="radio" name={name} checked={value === "unknown"} onChange={() => onChange("unknown")} />
              <span>{unknownLabel}</span>
            </label>
          </>
        )}
      </div>
    </fieldset>
  );
}

/** 복수 선택 (체크박스) + '해당 없음'([]) + '모름'(null) */
export function MultiGroup<V extends string>(props: {
  legend: string;
  hint?: string;
  options: Opt<V>[];
  value: V[] | null;
  onChange: (v: V[] | null) => void;
  noneLabel?: string;
  name: string;
}) {
  const id = useId();
  const { legend, hint, options, value, onChange, noneLabel = "해당 없음", name } = props;
  const toggle = (v: V) => {
    const cur = value ?? [];
    const next = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
    onChange(next.length ? next : null);
  };
  return (
    <fieldset className="field" aria-describedby={hint ? `${id}-h` : undefined}>
      <legend>
        {legend} <span className="small muted">(여러 개 선택)</span>
      </legend>
      {hint && (
        <p className="hint" id={`${id}-h`}>
          {hint}
        </p>
      )}
      <div className="opts">
        {options.map((o) => (
          <label className="opt" key={o.value}>
            <input type="checkbox" name={name} checked={!!value?.includes(o.value)} onChange={() => toggle(o.value)} />
            <span>{o.label}</span>
          </label>
        ))}
        <label className="opt">
          <input type="checkbox" name={name} checked={Array.isArray(value) && value.length === 0} onChange={() => onChange(value && value.length === 0 ? null : [])} />
          <span>{noneLabel}</span>
        </label>
        <p className="or" aria-hidden="true">
          또는
        </p>
        <label className="opt unknown">
          <input type="checkbox" name={name} checked={value === null} onChange={() => onChange(null)} />
          <span>모름 / 건너뛰기</span>
        </label>
      </div>
    </fieldset>
  );
}

export function opts<V extends string>(values: readonly V[], labels: Record<V, string>): Opt<V>[] {
  return values.map((v) => ({ value: v, label: labels[v] }));
}
