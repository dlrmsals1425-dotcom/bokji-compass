"use client";

import { useEffect, useRef } from "react";
import styles from "./WelfareMap.module.css";

const REST_ANGLE = -47;
const shortestTurn = (degrees: number) => ((degrees + 180) % 360 + 360) % 360 - 180;

/** 도입 회전 이후에만 커서를 따라간다. 스프링이 안정되면 프레임 요청도 끝낸다. */
export function CompassNeedle() {
  const ref = useRef<SVGGElement>(null);

  useEffect(() => {
    const needle = ref.current;
    const dial = needle?.ownerSVGElement;
    if (!needle || !dial) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mouse = window.matchMedia("(any-hover: hover) and (any-pointer: fine)");
    let disposed = false;
    let ready = false;
    let angle = REST_ANGLE;
    let target = angle;
    let velocity = 0;
    let frame = 0;
    let previousTime = 0;
    let pointer: { x: number; y: number } | null = null;
    let pointerChanged = false;

    const allowed = () => ready && !reduced.matches && mouse.matches && !document.hidden;
    const paint = () => { needle.style.transform = `rotate(${angle}deg)`; };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      previousTime = 0;
      velocity = 0;
      needle.dataset.motion = ready ? "idle" : "intro";
    };
    const pause = () => { pointer = null; stop(); };

    const tick = (time: number) => {
      if (!allowed()) { pause(); return; }
      if (pointerChanged && pointer) {
        pointerChanged = false;
        const box = dial.getBoundingClientRect();
        if (!box.width || box.bottom < 0 || box.top > window.innerHeight) { pause(); return; }
        const dx = pointer.x - (box.left + box.width / 2);
        const dy = pointer.y - (box.top + box.height / 2);
        // 중심을 통과할 때 방향이 급하게 뒤집히는 것을 막는다.
        if (Math.hypot(dx, dy) > 12) target = Math.atan2(dx, -dy) * 180 / Math.PI;
      }

      const elapsed = previousTime ? Math.min((time - previousTime) / 1000, .032) : 1 / 60;
      previousTime = time;
      // 작은 시간 간격으로 적분해 화면 주사율에 관계없이 가볍게 반동한다.
      const steps = Math.ceil(elapsed / (1 / 120));
      const dt = elapsed / steps;
      for (let step = 0; step < steps; step++) {
        velocity += (shortestTurn(target - angle) * 260 - velocity * 26) * dt;
        angle = shortestTurn(angle + velocity * dt);
      }
      if (Math.abs(shortestTurn(target - angle)) < .04 && Math.abs(velocity) < .1) {
        angle = target;
        paint();
        stop();
        return;
      }
      paint();
      frame = requestAnimationFrame(tick);
    };

    const follow = () => {
      if (!allowed() || !pointer || frame) return;
      needle.dataset.motion = "tracking";
      frame = requestAnimationFrame(tick);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || reduced.matches || !mouse.matches || document.hidden) return;
      pointer = { x: event.clientX, y: event.clientY };
      pointerChanged = true;
      follow();
    };
    const finishIntro = () => {
      if (disposed || ready) return;
      ready = true;
      needle.style.animation = "none";
      needle.dataset.motion = "idle";
      follow();
    };
    const onPreference = () => {
      if (reduced.matches) {
        finishIntro();
        angle = target = REST_ANGLE;
        paint();
      }
      pause();
    };
    const onVisibility = () => { if (document.hidden) pause(); };
    const onLeave = (event: PointerEvent) => { if (!event.relatedTarget) pause(); };

    // 서버 HTML부터 도입 모션이 재생된다. 늦게 연결되어 이미 끝났어도 추적을 시작한다.
    const intro = needle.getAnimations().find(animation => animation.playState === "running" || animation.pending);
    if (intro && !reduced.matches) void intro.finished.then(finishIntro, () => {});
    else finishIntro();

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerout", onLeave, { passive: true });
    window.addEventListener("blur", pause);
    window.addEventListener("resize", pause);
    window.addEventListener("scroll", pause, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    reduced.addEventListener("change", onPreference);
    mouse.addEventListener("change", onPreference);
    return () => {
      disposed = true;
      stop();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerout", onLeave);
      window.removeEventListener("blur", pause);
      window.removeEventListener("resize", pause);
      window.removeEventListener("scroll", pause);
      document.removeEventListener("visibilitychange", onVisibility);
      reduced.removeEventListener("change", onPreference);
      mouse.removeEventListener("change", onPreference);
    };
  }, []);

  return (
    <g ref={ref} className={styles.needle} data-testid="compass-needle" data-motion="intro">
      <path d="m90 37 17 53-17 14-17-14Z" fill="#e87850" />
      <path d="m90 143-17-53 17 14 17-14Z" fill="#294c37" />
      <path d="m90 37 17 53-17 14Z" fill="#cf5836" />
    </g>
  );
}
