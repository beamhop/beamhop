import type { ComponentType } from "react";

export type SlideProps = { active: boolean; reduced: boolean };

/** Placeholder — replaced with the final 5-slide story + beam visuals. */
function Placeholder(n: number) {
  return function Slide() {
    return (
      <div className="s-wrap s-center">
        <div className="s-stagger">
          <span className="s-readout">{`// 0${n}`}</span>
          <h2 className="s-title">Slide {n}</h2>
        </div>
      </div>
    );
  };
}

export const SLIDES: ComponentType<SlideProps>[] = [1, 2, 3, 4, 5].map(Placeholder);
