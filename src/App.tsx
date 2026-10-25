import { useEffect, useRef } from 'react';
import { mountGotzPuppyt } from './rig/engine.ts';

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const cleanup = mountGotzPuppyt(containerRef.current);
    return () => {
      cleanup?.();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full flex flex-col overflow-hidden select-none"
    />
  );
}
