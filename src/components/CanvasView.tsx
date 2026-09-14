import { useEffect, useRef } from 'react';
import { CanvasEngine } from '../engine/canvasEngine';
import type { Scene } from '../engine/scene';

interface Props {
  scene: Scene;
  onReady: (engine: CanvasEngine) => void;
  onStatus: (status: string) => void;
}

export function CanvasView({ scene, onReady, onStatus }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);
  const readyRef = useRef(onReady);
  const statusRef = useRef(onStatus);
  readyRef.current = onReady;
  statusRef.current = onStatus;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const engine = new CanvasEngine(canvas, scene, {
      onStatus: (s) => statusRef.current(s),
    });
    readyRef.current(engine);
    engine.fit();
    return () => engine.destroy();
  }, [scene]);

  return <canvas ref={ref} className="board" />;
}
